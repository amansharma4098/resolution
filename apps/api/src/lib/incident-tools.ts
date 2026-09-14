import { z } from "zod";
import type { PrismaClient, OrganizationRepository, Membership } from "@resolution/database";
import { IncidentRepository, RootCauseAnalysisRepository } from "@resolution/database";
import { IncidentStatus } from "@resolution/shared";
import { hasRole } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import { AppError } from "./errors";
import { investigateIncident, proposeRemediationForIncident, decideRemediationApproval } from "./incident-actions";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";

const ORG_AND_INCIDENT = {
  tenantId: { type: "string" as const, description: "The organization the incident belongs to." },
  incidentId: { type: "string" as const },
};

/**
 * The tool catalog behind both `POST /api/mcp` (routes/mcp.ts, for an external MCP client)
 * and `POST /api/chat` (routes/chat.ts, the in-app dashboard assistant) — one definition of
 * "what this platform lets an authenticated caller do to an incident," shared rather than
 * duplicated across the two entry points. JSON Schema `inputSchema` here doubles as
 * Anthropic's `input_schema` for the chat's tool-calling loop — the shapes are identical.
 *
 * The three mutating tools (trigger_investigation, propose_remediation, decide_approval)
 * call the exact same functions `incident-actions.ts` extracts for routes/incidents.ts's
 * HTTP handlers — never a re-implementation that could quietly drift from the state-machine
 * checks, policy-engine approval gating, or audit logging the dashboard enforces. A thrown
 * AppError from those becomes a `{ isError: true }` tool result (see `runAction`).
 */
export const TOOLS = [
  {
    name: "list_incidents",
    description:
      "List incidents for an organization the caller belongs to. Each result includes `source` (which connected platform it came from — JIRA, SERVICENOW, WEBHOOK) — group and present results by source/platform unless the user asks otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string", description: "The organization to list incidents for." },
        status: { type: "string", enum: IncidentStatus.options, description: "Filter by status." },
        limit: { type: "integer", description: "Max incidents to return (default 20, max 100)." },
      },
      required: ["tenantId"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_incident",
    description: "Get full detail for one incident.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["tenantId", "incidentId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_rca",
    description: "Get the latest root cause analysis for one incident, if one exists yet.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["tenantId", "incidentId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "trigger_investigation",
    description:
      "Start (or restart) an AI investigation for an incident. Only valid from certain statuses (NEW, ESCALATED, FAILED) — the tool reports the current status if it isn't one of those.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["tenantId", "incidentId"] },
    annotations: { readOnlyHint: false },
  },
  {
    name: "propose_remediation",
    description:
      "Ask the Resolution Agent to propose a remediation for an incident whose root cause analysis is already complete (status RCA_COMPLETE). The agent automatically picks whichever connected Map Server (including any org-configured MCP server) can actually perform the fix — the caller never names one.",
    inputSchema: { type: "object", properties: ORG_AND_INCIDENT, required: ["tenantId", "incidentId"] },
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
      required: ["tenantId", "incidentId", "approvalId", "decision"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
] as const;

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
}

export function textResult(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

/** Membership only — a tool call defaults to whatever access a MEMBER already has in the
 *  dashboard; `decide_approval` additionally requires ADMIN+ (see its own check below). A
 *  non-member gets the same "not found" (never "forbidden") as everywhere else in this
 *  codebase (resolveTenantContext's header comment) — org existence isn't disclosed to
 *  someone with no access to it. */
async function getMembership(
  organizationRepository: OrganizationRepository,
  userId: string,
  tenantId: string,
): Promise<Membership | null> {
  return organizationRepository.findMembership(userId, tenantId);
}

/** Runs a mutating incident-action function and turns its thrown AppError into a tool-level
 *  error result instead of a protocol-level failure — the same "business logic failure vs.
 *  malformed request" distinction MCP draws for tools/call, reused here for the chat loop
 *  too (a tool_result with is_error lets the model see and react to the failure). */
async function runAction<T>(action: () => Promise<T>): Promise<ToolResult> {
  try {
    return textResult(await action());
  } catch (err) {
    if (err instanceof AppError) return textResult({ error: err.message }, true);
    throw err;
  }
}

export interface IncidentToolDeps {
  db: PrismaClient;
  organizationRepository: OrganizationRepository;
  investigationQueue: IncidentInvestigationQueue;
  remediationQueue: IncidentRemediationQueue;
  secretProvider: SecretProvider;
}

export async function callIncidentTool(
  deps: IncidentToolDeps,
  userId: string,
  requestId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { db, organizationRepository } = deps;

  switch (name) {
    case "list_incidents": {
      const parsed = z
        .object({
          tenantId: z.string(),
          status: IncidentStatus.optional(),
          limit: z.number().int().positive().max(100).optional(),
        })
        .safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.tenantId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.tenantId);
      let list = await incidents.list();
      if (parsed.data.status) list = list.filter((i) => i.status === parsed.data.status);
      list = list.slice(0, parsed.data.limit ?? 20);
      return textResult(
        list.map((i) => ({
          id: i.id,
          source: i.source,
          title: i.title,
          status: i.status,
          severity: i.severity,
          createdAt: i.createdAt,
        })),
      );
    }

    case "get_incident": {
      const parsed = z.object({ tenantId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.tenantId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.tenantId);
      const incident = await incidents.findById(parsed.data.incidentId);
      if (!incident) return textResult({ error: "Incident not found" }, true);
      return textResult(incident);
    }

    case "get_rca": {
      const parsed = z.object({ tenantId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.tenantId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      const incidents = new IncidentRepository(db, parsed.data.tenantId);
      const incident = await incidents.findById(parsed.data.incidentId);
      if (!incident) return textResult({ error: "Incident not found" }, true);
      const rca = await new RootCauseAnalysisRepository(db).findLatestByIncident(incident.id);
      if (!rca) return textResult({ error: "No root cause analysis yet for this incident" }, true);
      return textResult(rca);
    }

    case "trigger_investigation": {
      const parsed = z.object({ tenantId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.tenantId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      return runAction(() => investigateIncident({ db, investigationQueue: deps.investigationQueue }, parsed.data));
    }

    case "propose_remediation": {
      const parsed = z.object({ tenantId: z.string(), incidentId: z.string() }).safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      if (!(await getMembership(organizationRepository, userId, parsed.data.tenantId))) {
        return textResult({ error: "Organization not found" }, true);
      }
      return runAction(() =>
        proposeRemediationForIncident({ db, remediationQueue: deps.remediationQueue }, parsed.data),
      );
    }

    case "decide_approval": {
      const parsed = z
        .object({
          tenantId: z.string(),
          incidentId: z.string(),
          approvalId: z.string(),
          decision: z.enum(["APPROVE", "REJECT"]),
          reason: z.string().max(2000).optional(),
        })
        .safeParse(args);
      if (!parsed.success) return textResult({ error: "Invalid arguments" }, true);
      const membership = await getMembership(organizationRepository, userId, parsed.data.tenantId);
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
