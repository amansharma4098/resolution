import { assertExecutionAllowed } from "./execution-permission";
import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  RemediationRepository,
  MapServerRepository,
  CredentialRepository,
  auditLogWriter,
} from "@resolution/database";
import { getMapServerProvider, resolveCapability } from "@resolution/map-servers";
import { canTransition, transition } from "@resolution/agents";
import { writeAuditLog } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import type { LlmClient } from "@resolution/ai";
import { NotFoundError, ConflictError, ValidationError } from "./errors";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";
import { executeAndVerify } from "../queue/remediation-consumer";

/**
 * The actual behavior behind "investigate" / "propose remediation" / "decide an approval" —
 * pulled out of routes/incidents.ts so routes/mcp.ts's `decide_approval` etc. tools call
 * exactly this, not a re-implementation that could quietly drift from what the dashboard
 * enforces (the state-machine check, the policy engine's approval gating, the audit log).
 * Both callers pass in whichever identity fields differ (a session's userId, or an API
 * key's) and translate a thrown AppError into their own response shape — a Hono route via
 * the global error handler, an MCP tool into `{ isError: true }` content
 * (routes/mcp.ts's callTool).
 */

export async function investigateIncident(
  deps: { db: PrismaClient; investigationQueue: IncidentInvestigationQueue },
  params: { tenantId: string; incidentId: string },
): Promise<{ status: "investigating" }> {
  const incidents = new IncidentRepository(deps.db, params.tenantId);
  const incident = await incidents.findById(params.incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  if (!canTransition(incident.status, "INVESTIGATING")) {
    throw new ConflictError(`Cannot start an investigation from status ${incident.status}`);
  }

  await deps.investigationQueue.send({ incidentId: incident.id, tenantId: params.tenantId });
  return { status: "investigating" };
}

export async function proposeRemediationForIncident(
  deps: { db: PrismaClient; remediationQueue: IncidentRemediationQueue },
  params: { tenantId: string; incidentId: string },
): Promise<{ status: "proposing" }> {
  const incidents = new IncidentRepository(deps.db, params.tenantId);
  const incident = await incidents.findById(params.incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  if (incident.status !== "RCA_COMPLETE") {
    throw new ConflictError(
      `Cannot propose a remediation from status ${incident.status} — needs RCA_COMPLETE`,
    );
  }

  await deps.remediationQueue.send({ incidentId: incident.id, tenantId: params.tenantId });
  return { status: "proposing" };
}

export async function decideRemediationApproval(
  deps: { db: PrismaClient; secretProvider: SecretProvider; llmClient: LlmClient },
  params: {
    tenantId: string;
    incidentId: string;
    approvalId: string;
    decision: "APPROVE" | "REJECT";
    reason?: string;
    /** Whoever is deciding — a session's userId, or an API key's owning userId. Recorded on
     *  the Approval row and the audit log the same way either path. */
    actorUserId: string;
    requestId: string;
  },
): Promise<{ approval: unknown; status: "REJECTED" | "EXECUTED" }> {
  const { db, secretProvider, llmClient } = deps;
  const { tenantId } = params;
  const incidents = new IncidentRepository(db, tenantId);
  const incident = await incidents.findById(params.incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  const remediationRepo = new RemediationRepository(db);
  const approval = await remediationRepo.findApprovalById(params.approvalId);
  if (!approval) throw new NotFoundError("Approval not found");

  const action = await remediationRepo.findRemediationActionById(approval.remediationActionId);
  if (!action) throw new NotFoundError("Remediation action not found");
  const resolution = await remediationRepo.findResolutionById(action.resolutionId);
  if (!resolution || resolution.incidentId !== incident.id)
    throw new NotFoundError("Approval not found");

  if (approval.status !== "PENDING") {
    throw new ConflictError(`This approval was already ${approval.status.toLowerCase()}`);
  }
  if (incident.status !== "PENDING_APPROVAL") {
    throw new ConflictError(`Incident is no longer awaiting approval (status: ${incident.status})`);
  }

  if (params.decision === "APPROVE") {
    if (!resolution.mapServerId || !resolution.capabilityKey)
      throw new ValidationError("Resolution has no executable capability");
    await assertExecutionAllowed(db, {
      tenantId,
      incidentId: incident.id,
      mapServerId: resolution.mapServerId,
      capabilityKey: resolution.capabilityKey,
      approved: true,
    });
  }

  const decided = await remediationRepo.decideApproval(approval.id, {
    status: params.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    decidedByUserId: params.actorUserId,
    reason: params.reason,
  });

  await writeAuditLog(auditLogWriter(db), {
    tenantId,
    actorType: "user",
    actorId: params.actorUserId,
    action: params.decision === "APPROVE" ? "remediation.approved" : "remediation.rejected",
    targetType: "RemediationAction",
    targetId: action.id,
    requestId: params.requestId,
    metadata: { reason: params.reason },
  });

  if (params.decision === "REJECT") {
    await db.incident.update({
      where: { id: incident.id },
      data: { status: transition(incident.status, "ESCALATED") },
    });
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "approval_rejected",
        actor: params.actorUserId,
        detail: JSON.stringify({ reason: params.reason ?? null }),
      },
    });
    return { approval: decided, status: "REJECTED" };
  }

  if (!resolution.mapServerId || !resolution.capabilityKey) {
    throw new ValidationError("This resolution has no capability to execute");
  }
  const mapServers = new MapServerRepository(db, tenantId);
  const mapServer = await mapServers.findById(resolution.mapServerId);
  if (!mapServer) throw new ValidationError("The Map Server for this resolution no longer exists");
  const provider = getMapServerProvider(mapServer.type);
  if (!provider) {
    throw new ValidationError("The capability for this resolution is no longer available");
  }
  let approvalCredential: Record<string, unknown> = {};
  if (mapServer.credentialId) {
    const credentialRow = await new CredentialRepository(db, tenantId).findUsableById(
      mapServer.credentialId,
    );
    if (credentialRow) {
      approvalCredential = await secretProvider.decrypt(credentialRow.encryptedData, { tenantId });
    }
  }
  const capability = await resolveCapability(
    provider,
    {
      tenantId,
      mapServerId: mapServer.id,
      environment: mapServer.environments[0] ?? "default",
      credential: approvalCredential,
      config: mapServer.config,
      requestId: params.requestId,
    },
    resolution.capabilityKey,
  );
  if (!capability) {
    throw new ValidationError("The capability for this resolution is no longer available");
  }

  await db.incident.update({
    where: { id: incident.id },
    data: { status: transition(incident.status, "REMEDIATING") },
  });
  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: "approval_granted",
      actor: params.actorUserId,
      detail: JSON.stringify({ reason: params.reason ?? null }),
    },
  });

  // Executed synchronously — a single capability call plus a short bounded verification
  // loop (packages/agents' verification-runner, a few seconds at most), not re-queued. See
  // remediation-consumer.ts's header comment on why the AUTO path already does the same
  // thing inline rather than round-tripping through another queue message.
  await executeAndVerify(db, {
    tenantId,
    approved: true,
    incidentId: incident.id,
    mapServerId: resolution.mapServerId,
    mapServerType: mapServer.type,
    capability,
    input: resolution.input,
    remediationActionId: action.id,
    secretProvider,
    llmClient,
  });

  return { approval: decided, status: "EXECUTED" };
}
