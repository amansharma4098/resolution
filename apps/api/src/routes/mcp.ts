import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient, OrganizationRepository } from "@resolution/database";
import { ApiKeyRepository, IncidentRepository, RootCauseAnalysisRepository } from "@resolution/database";
import { IncidentStatus } from "@resolution/shared";
import type { Env } from "../env";
import { authenticateApiKey } from "../middleware/authenticate-api-key";
import type { AppEnv } from "../types";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

/**
 * Exposes this platform's own incident data as an MCP server — so a user's own MCP client
 * (Claude Desktop, another agent) can ask "what's the status of incident X" without opening
 * the dashboard. The mirror image of packages/map-servers/src/mcp (which lets Resolution's
 * agent *consume* an org's MCP servers) — this is Resolution being one instead.
 *
 * Deliberately read-only for this first pass: no tool here can trigger an investigation or
 * a remediation. Widening that would mean routing a tool call through the same
 * policy-engine/approval gating every other mutating action goes through
 * (ARCHITECTURE.md §7) — real scope, tracked as a follow-up, not done implicitly by adding
 * a tool here.
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
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        incidentId: { type: "string" },
      },
      required: ["organizationId", "incidentId"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_rca",
    description: "Get the latest root cause analysis for one incident, if one exists yet.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        incidentId: { type: "string" },
      },
      required: ["organizationId", "incidentId"],
    },
    annotations: { readOnlyHint: true },
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

/** Membership, not role — an MCP tool call is read-only, so any member (not just an
 *  ADMIN/OWNER) can use it, the same access a MEMBER already has in the dashboard. A
 *  non-member gets the same "not found" (never "forbidden") as everywhere else in this
 *  codebase (resolveTenantContext's header comment) — org existence isn't disclosed to
 *  someone with no access to it. */
async function requireMembership(
  organizationRepository: OrganizationRepository,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const membership = await organizationRepository.findMembership(userId, organizationId);
  return membership !== null;
}

async function callTool(
  db: PrismaClient,
  organizationRepository: OrganizationRepository,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
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
      if (!(await requireMembership(organizationRepository, userId, parsed.data.organizationId))) {
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
      if (!(await requireMembership(organizationRepository, userId, parsed.data.organizationId))) {
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
      if (!(await requireMembership(organizationRepository, userId, parsed.data.organizationId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.organizationId);
      const incident = await incidents.findById(parsed.data.incidentId);
      if (!incident) return textResult({ error: "Incident not found" }, true);
      const rca = await new RootCauseAnalysisRepository(db).findLatestByIncident(incident.id);
      if (!rca) return textResult({ error: "No root cause analysis yet for this incident" }, true);
      return textResult(rca);
    }

    default:
      return textResult({ error: `Unknown tool: ${name}` }, true);
  }
}

export function buildMcpRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, organizationRepository } = deps;
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
        const result = await callTool(db, organizationRepository, userId, params.data.name, params.data.arguments);
        return c.json(jsonRpcResult(body.id, result));
      }

      default:
        return c.json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
    }
  });

  return router;
}
