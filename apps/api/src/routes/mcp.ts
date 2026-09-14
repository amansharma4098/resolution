import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient, OrganizationRepository, Membership } from "@resolution/database";
import { ApiKeyRepository, IncidentRepository, RootCauseAnalysisRepository } from "@resolution/database";
import { IncidentStatus } from "@resolution/shared";
import { hasRole } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import type { Env } from "../env";
import { authenticateApiKey } from "../middleware/authenticate-api-key";
import { AppError } from "../lib/errors";
import { investigateIncident, proposeRemediationForIncident, decideRemediationApproval } from "../lib/incident-actions";
import type { AppEnv } from "../types";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

const ORG_AND_INCIDENT = {
  organizationId: { type: "string" as const, description: "The organization the incident belongs to." },
  incidentId: { type: "string" as const },
};

/**
 * Exposes this platform's own incident data — and now its resolution flow — as an MCP
 * server, so a user's own MCP client (Claude Desktop, another agent) can investigate,
 * propose a remediation, and approve/reject it without opening the dashboard. The mirror
 * image of packages/map-servers/src/mcp (which lets Resolution's agent *consume* an org's
 * MCP servers) — this is Resolution being one instead.
 *
 * The three mutating tools (trigger_investigation, propose_remediation, decide_approval)
 * call the exact same functions apps/api/src/lib/incident-actions.ts extracts for
 * routes/incidents.ts's HTTP handlers — never a re-implementation that could quietly drift
 * from the state-machine checks, policy-engine approval gating, or audit logging the
 * dashboard enforces. A thrown AppError from those becomes a `{ isError: true }` tool
 * result here (see `callTool`), the MCP-appropriate equivalent of the HTTP status it maps
 * to for a normal route.
 */
const TOOLS = [
  {
    name: "list_incidents",
    description: "List incidents for an organization this API key's owner belongs to.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "The organization to list incidents for." },
        status: { type: "string", enum: IncidentStatus.options, description: "Filter by status." },
        limit: { type: "integer", description: "Max incidents to return (default 20, max 100)." },
      },
      required: ["organizationId"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_incident",
    description: "Get full detail for one incident.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["organizationId", "incidentId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_rca",
    description: "Get the latest root cause analysis for one incident, if one exists yet.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["organizationId", "incidentId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "trigger_investigation",
    description:
      "Start (or restart) an AI investigation for an incident. Only valid from certain statuses (NEW, ESCALATED, FAILED) — the tool reports the current status if it isn't one of those.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["organizationId", "incidentId"] },
    annotations: { readOnlyHint: false },
  },
  {
    name: "propose_remediation",
    description:
      "Ask the Resolution Agent to propose a remediation for an incident whose root cause analysis is already complete (status RCA_COMPLETE).",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["organizationId", "incidentId"] },
    annotations: { readOnlyHint: false },
  },
  {
    name: "decide_approval",
    description:
      "Approve or reject a pending remediation approval. Approving executes the remediation immediately and runs its verification, subject to the exact same checks as approving it in the dashboard. Requires the caller to be an ADMIN or OWNER of the organization.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_AND_INCIDENT,
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["APPROVE", "REJECT"] },
        reason: { type: "string", description: "Optional note recorded on the approval." },
      },
      required: ["organizationId", "incidentId", "approvalId", "decision"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
] as const;

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

/** Membership only — an MCP tool call defaults to whatever access a MEMBER already has in
 *  the dashboard; `decide_approval` additionally requires ADMIN+ (see its own check below).
 *  A non-member gets the same "not found" (never "forbidden") as everywhere else in this
 *  codebase (resolveTenantContext's header comment) — org existence isn't disclosed to
 *  someone with no access to it. */
async function getMembership(
  organizationRepository: OrganizationRepository,
  userId: string,
  organizationId: string,
): Promise<Membership | null> {
  return organizationRepository.findMembership(userId, organizationId);
}

/** Runs a mutating incident-action function and turns its thrown AppError into a tool-level
 *  error result instead of a protocol-level JSON-RPC error — the same "business logic
 *  failure vs. malformed request" distinction MCP draws for tools/call. */
async function runAction<T>(action: () => Promise<T>): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
  try {
    return textResult(await action());
  } catch (err) {
    if (err instanceof AppError) return textResult({ error: err.message }, true);
    throw err;
  }
}

async function callTool(
  deps: {
    db: PrismaClient;
    organizationRepository: OrganizationRepository;
    investigationQueue: IncidentInvestigationQueue;
    remediationQueue: IncidentRemediationQueue;
    secretProvider: SecretProvider;
  },
  userId: string,
  requestId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
  const { db, organizationRepository } = deps;

  switch (name) {
    case "list_incidents": {
      const parsed = z
        .object({
          organizationId: z.string(),
          status: IncidentStatus.optional(),
          limit: z.number().int().positive().max(100).optional(),
        })
        .safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.organizationId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.organizationId);
      let list = await incidents.list();
      if (parsed.data.status) list = list.filter((i) => i.status === parsed.data.status);
      list = list.slice(0, parsed.data.limit ?? 20);
      return textResult(
        list.map((i) => ({ id: i.id, title: i.title, status: i.status, severity: i.severity, createdAt: i.createdAt })),
      );
    }

    case "get_incident": {
      const parsed = z.object({ organizationId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.organizationId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.organizationId);
      const incident = await incidents.findById(parsed.data.incidentId);
      if (!incident) return textResult({ error: "Incident not found" }, true);
      return textResult(incident);
    }

    case "get_rca": {
      const parsed = z.object({ organizationId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.organizationId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.organizationId);
      const incident = await incidents.findById(parsed.data.incidentId);
      if (!incident) return textResult({ error: "Incident not found" }, true);
      const rca = await new RootCauseAnalysisRepository(db).findLatestByIncident(incident.id);
      if (!rca) return textResult({ error: "No root cause analysis yet for this incident" }, true);
      return textResult(rca);
    }

    case "trigger_investigation": {
      const parsed = z.object({ organizationId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.organizationId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      return runAction(() =>
        investigateIncident({ db, investigationQueue: deps.investigationQueue }, parsed.data),
      );
    }

    case "propose_remediation": {
      const parsed = z.object({ organizationId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.organizationId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      return runAction(() =>
        proposeRemediationForIncident({ db, remediationQueue: deps.remediationQueue }, parsed.data),
      );
    }

    case "decide_approval": {
      const parsed = z
        .object({
          organizationId: z.string(),
          incidentId: z.string(),
          approvalId: z.string(),
          decision: z.enum(["APPROVE", "REJECT"]),
          reason: z.string().max(2000).optional(),
        })
        .safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      const membership = await getMembership(organizationRepository, userId, parsed.data.organizationId);
      if (!membership) return textResult({ error: "Organization not found" }, true);
      // Same bar as the dashboard's requireMinimumRole("ADMIN") on this route — deciding an
      // approval can execute a real, possibly mutating action, so a plain MEMBER (who can
      // use every read-only tool above) still can't do this one.
      if (!hasRole(membership.role, "ADMIN")) {
        return textResult({ error: "This action requires the ADMIN role or higher" }, true);
      }
      return runAction(() =>
        decideRemediationApproval(
          { db, secretProvider: deps.secretProvider },
          { ...parsed.data, actorUserId: userId, requestId },
        ),
      );
    }

    default:
      return textResult({ error: `Unknown tool: ${name}` }, true);
  }
}

export function buildMcpRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
  investigationQueue: IncidentInvestigationQueue;
  remediationQueue: IncidentRemediationQueue;
  secretProvider: SecretProvider;
}): Hono<AppEnv> {
  const { db } = deps;
  const router = new Hono<AppEnv>();
  const apiKeys = new ApiKeyRepository(db);
  const auth = authenticateApiKey(apiKeys);

  // One endpoint, JSON-RPC-dispatched per MCP's Streamable HTTP transport — see
  // packages/map-servers/src/mcp/client.ts's header comment for the transport this mirrors.
  router.post("/", auth, async (c) => {
    const userId = c.get("userId")!;
    const body = (await c.req.json()) as JsonRpcRequest;

    // A notification (no `id`) never gets a body back — the client's
    // `notifications/initialized` after our `initialize` response arrives this way.
    if (body.id === undefined) {
      return c.body(null, 202);
    }

    switch (body.method) {
      case "initialize":
        return c.json(
          jsonRpcResult(body.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "resolution", version: "0.1.0" },
          }),
        );

      case "tools/list":
        return c.json(jsonRpcResult(body.id, { tools: TOOLS }));

      case "tools/call": {
        const params = z
          .object({ name: z.string(), arguments: z.record(z.unknown()).default({}) })
          .safeParse(body.params);
        if (!params.success) {
          return c.json(jsonRpcError(body.id, -32602, "Invalid params"));
        }
        const result = await callTool(
          deps,
          userId,
          c.get("requestId"),
          params.data.name,
          params.data.arguments,
        );
        return c.json(jsonRpcResult(body.id, result));
      }

      default:
        return c.json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
    }
  });

  return router;
}
