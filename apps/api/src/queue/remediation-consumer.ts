import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  RootCauseAnalysisRepository,
  MapServerRepository,
  CredentialRepository,
  AutomationPolicyRepository,
  RemediationRepository,
  OrganizationRepository,
  auditLogWriter,
  serializeJsonField,
} from "@resolution/database";
import { getMapServerProvider, type AnyCapability, type MapServerContext, type MapServerType } from "@resolution/map-servers";
import { createLlmClient, type LlmClient } from "@resolution/ai";
import {
  evaluatePolicy,
  runResolutionAgent,
  runVerification,
  transition,
  ResolutionIncompleteError,
  type AvailableCapability,
} from "@resolution/agents";
import type { PolicyBehavior, ResolutionMode } from "@resolution/shared";
import { writeAuditLog } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import type { RemediationQueueMessage } from "./types";

export interface RemediationRunnerConfig {
  mockMode: boolean;
  anthropicApiKey?: string;
  anthropicModel?: string;
  secretProvider: SecretProvider;
  llmClient?: LlmClient;
  /** Real setTimeout-based delay by default; tests override with a no-op so the bounded
   *  verification retry loop below doesn't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_VERIFY_ATTEMPTS = 3;
const VERIFY_RETRY_DELAY_MS = 2000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Resolution/Policy/Execution/Verification pipeline's entry point — run by the
 * Cloudflare Queue consumer (worker.ts's `queue` export) in production and synchronously by
 * inline-remediation-queue.ts in tests/local dev, same pattern as the other two consumers.
 *
 * One queue, one message, one consumer invocation covers propose → policy-gate → (if AUTO)
 * execute → verify — not four separate queues. Unlike ingestion→investigation (genuinely
 * independent, arbitrarily-delayed hops), these steps are one causal chain triggered by one
 * event (RCA_COMPLETE) with no reason to decouple their timing; ARCHITECTURE.md §10 notes
 * the same reasoning for folding `ai-analysis` into `incident-investigation`.
 *
 * Cloudflare Queues deliver at-least-once, so this must be safely re-runnable: the
 * `status !== "RCA_COMPLETE"` guard is the dedup (a redelivered message finding the incident
 * already PENDING_APPROVAL/REMEDIATING/etc. is a no-op), not a unique constraint — running
 * the Resolution Agent twice would mean two real (billed) LLM calls, not a duplicate row.
 */
export async function processRemediationMessage(
  db: PrismaClient,
  config: RemediationRunnerConfig,
  message: RemediationQueueMessage,
): Promise<void> {
  const incidents = new IncidentRepository(db, message.organizationId);
  const incident = await incidents.findById(message.incidentId);
  if (!incident) return;
  if (incident.status !== "RCA_COMPLETE") return;

  const rcaRepo = new RootCauseAnalysisRepository(db);
  const rcaRow = await rcaRepo.findLatestByIncident(incident.id);
  if (!rcaRow) return; // shouldn't happen (RCA_COMPLETE implies one exists) — fail closed, not throw

  const mapServers = new MapServerRepository(db, message.organizationId);
  const allMapServers = await mapServers.list();
  const availableCapabilities: AvailableCapability[] = [];
  for (const server of allMapServers) {
    const provider = getMapServerProvider(server.type);
    if (!provider) continue;
    const capabilityRows = await mapServers.listCapabilities(server.id);
    // The inverse filter from investigation: remediation only ever sees mutating,
    // explicitly-enabled capabilities. A read-only capability is never a "remediation".
    for (const row of capabilityRows.filter((r) => r.enabled && r.mutating)) {
      const capability = provider.capabilities.find((c) => c.key === row.key);
      if (capability) {
        availableCapabilities.push({ mapServerId: server.id, mapServerType: server.type, capability });
      }
    }
  }

  const llmClient =
    config.llmClient ??
    createLlmClient({ mockMode: config.mockMode, apiKey: config.anthropicApiKey, model: config.anthropicModel });

  const rca = {
    summary: rcaRow.summary,
    claims: rcaRow.claims,
    confidence: rcaRow.confidence,
    alternativeHypotheses: rcaRow.alternativeHypotheses,
  };

  let resolutionResult;
  try {
    resolutionResult = await runResolutionAgent(
      {
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        priority: incident.priority,
        source: incident.source,
        service: incident.service,
        environment: incident.environment,
      },
      rca,
      { llmClient, availableCapabilities },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "remediation_failed",
        actor: "agent",
        detail: serializeJsonField({ reason, incomplete: err instanceof ResolutionIncompleteError }),
      },
    });
    await writeAuditLog(auditLogWriter(db), {
      organizationId: message.organizationId,
      actorType: "agent",
      action: "incident.remediation_proposal_failed",
      targetType: "Incident",
      targetId: incident.id,
      metadata: { reason },
    });
    return; // stays at RCA_COMPLETE — a human can retry manually later; not a hard failure
  }

  if (resolutionResult.kind === "no_action") {
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "remediation_not_proposed",
        actor: "agent",
        detail: serializeJsonField({ reason: resolutionResult.reason }),
      },
    });
    return;
  }

  const { proposal } = resolutionResult;
  const remediationRepo = new RemediationRepository(db);
  const resolution = await remediationRepo.createResolution({
    incidentId: incident.id,
    rcaId: rcaRow.id,
    proposedAction: proposal.proposedAction,
    mapServerId: proposal.mapServerId,
    capabilityKey: proposal.capability.key,
    input: proposal.input,
    riskLevel: proposal.capability.riskLevel,
  });
  const idempotencyKey = `${incident.id}:${proposal.capability.key}:${crypto.randomUUID()}`;
  const action = await remediationRepo.createRemediationAction(resolution.id, idempotencyKey);

  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: "remediation_proposed",
      actor: "agent",
      detail: serializeJsonField({
        proposedAction: proposal.proposedAction,
        capabilityKey: proposal.capability.key,
        riskLevel: proposal.capability.riskLevel,
      }),
    },
  });

  const organizations = new OrganizationRepository(db);
  const organization = await organizations.findById(message.organizationId);
  const orgResolutionMode = (organization?.resolutionMode ?? "OBSERVE_ONLY") as ResolutionMode;

  const policies = new AutomationPolicyRepository(db, message.organizationId);
  const policyRow = await policies.findForCapability(proposal.mapServerType, proposal.capability.key);
  const behavior: PolicyBehavior = evaluatePolicy(
    orgResolutionMode,
    policyRow ? { behavior: policyRow.behavior, resolutionModeFloor: policyRow.resolutionModeFloor } : undefined,
  );

  await writeAuditLog(auditLogWriter(db), {
    organizationId: message.organizationId,
    actorType: "agent",
    action: "incident.remediation_proposed",
    targetType: "Incident",
    targetId: incident.id,
    metadata: { capabilityKey: proposal.capability.key, behavior, mock: llmClient.isMock },
  });

  if (behavior === "DENY") {
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "remediation_denied_by_policy",
        actor: "system",
        detail: serializeJsonField({ resolutionMode: orgResolutionMode }),
      },
    });
    return; // RemediationAction stays PENDING forever — never executed without a policy change
  }

  if (behavior === "APPROVAL") {
    await remediationRepo.createApproval(action.id);
    await db.incident.update({
      where: { id: incident.id },
      data: { status: transition(incident.status, "PENDING_APPROVAL") },
    });
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "approval_requested",
        actor: "system",
        detail: serializeJsonField({ remediationActionId: action.id }),
      },
    });
    return;
  }

  // behavior === "AUTO"
  await db.incident.update({
    where: { id: incident.id },
    data: { status: transition(incident.status, "REMEDIATING") },
  });
  await executeAndVerify(db, {
    organizationId: message.organizationId,
    incidentId: incident.id,
    mapServerId: proposal.mapServerId,
    mapServerType: proposal.mapServerType,
    capability: proposal.capability,
    input: proposal.input,
    remediationActionId: action.id,
    secretProvider: config.secretProvider,
    sleep: config.sleep ?? defaultSleep,
  });
}

/**
 * Shared by the AUTO path above and the approval-decision route (an approved action is
 * executed the same way an auto-approved one is — the only difference is what got it here).
 * Exported so apps/api/src/routes/incidents.ts can call it directly on approval, synchronously,
 * rather than round-tripping through the queue for a single already-decided action.
 */
export async function executeAndVerify(
  db: PrismaClient,
  params: {
    organizationId: string;
    incidentId: string;
    mapServerId: string;
    mapServerType: MapServerType;
    capability: AnyCapability;
    input: unknown;
    remediationActionId: string;
    secretProvider: SecretProvider;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const sleep = params.sleep ?? defaultSleep;
  const remediationRepo = new RemediationRepository(db);
  const mapServers = new MapServerRepository(db, params.organizationId);
  const credentials = new CredentialRepository(db, params.organizationId);

  const contextFor = async (mapServerId: string): Promise<MapServerContext> => {
    const server = await mapServers.findById(mapServerId);
    let credential: Record<string, unknown> = {};
    if (server?.credentialId) {
      const credentialRow = await credentials.findById(server.credentialId);
      if (credentialRow) {
        credential = await params.secretProvider.decrypt(credentialRow.encryptedData, {
          organizationId: params.organizationId,
        });
      }
    }
    return {
      organizationId: params.organizationId,
      mapServerId,
      environment: server?.environments[0] ?? "default",
      credential,
      requestId: crypto.randomUUID(),
    };
  };

  await remediationRepo.updateRemediationActionStatus(params.remediationActionId, "EXECUTING");

  let output: unknown;
  try {
    const ctx = await contextFor(params.mapServerId);
    output = await params.capability.execute(ctx, params.input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await remediationRepo.updateRemediationActionStatus(params.remediationActionId, "FAILED", {
      result: { error: reason },
    });
    await db.incident.update({
      where: { id: params.incidentId },
      data: { status: transition("REMEDIATING", "FAILED") },
    });
    await db.incidentEvent.create({
      data: {
        incidentId: params.incidentId,
        type: "remediation_execution_failed",
        actor: "system",
        detail: serializeJsonField({ reason }),
      },
    });
    return;
  }

  await remediationRepo.updateRemediationActionStatus(params.remediationActionId, "SUCCEEDED", {
    executedAt: new Date(),
    result: output,
  });
  await db.incident.update({
    where: { id: params.incidentId },
    data: { status: transition("REMEDIATING", "VERIFYING") },
  });
  await db.incidentEvent.create({
    data: {
      incidentId: params.incidentId,
      type: "remediation_executed",
      actor: "system",
      detail: serializeJsonField({ capabilityKey: params.capability.key }),
    },
  });

  if (!params.capability.verification) {
    // Nothing to automatically re-check — honestly resolved on "executed without error"
    // alone, not silently upgraded to a confirmed-verified state.
    await db.incident.update({ where: { id: params.incidentId }, data: { status: transition("VERIFYING", "RESOLVED") } });
    await db.incidentEvent.create({
      data: {
        incidentId: params.incidentId,
        type: "resolved",
        actor: "system",
        detail: serializeJsonField({ verified: false, reason: "capability declares no verification companion" }),
      },
    });
    return;
  }

  for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt++) {
    const result = await runVerification({
      mapServerType: params.mapServerType,
      mapServerId: params.mapServerId,
      capabilityKey: params.capability.key,
      mutatingInput: params.input,
      mutatingOutput: output,
      contextFor,
    });

    if (!result) {
      // Declared verification but the runner couldn't actually run it (misconfigured
      // companion capability) — same honest "resolved, unverified" outcome as no-verification.
      await db.incident.update({ where: { id: params.incidentId }, data: { status: transition("VERIFYING", "RESOLVED") } });
      await db.incidentEvent.create({
        data: {
          incidentId: params.incidentId,
          type: "resolved",
          actor: "system",
          detail: serializeJsonField({ verified: false, reason: "verification companion misconfigured" }),
        },
      });
      return;
    }

    await remediationRepo.createVerification(params.remediationActionId, {
      status: result.status,
      expectedState: result.expectedState,
      actualState: result.actualState,
      attempt,
    });

    if (result.status === "PASSED") {
      await db.incident.update({ where: { id: params.incidentId }, data: { status: transition("VERIFYING", "RESOLVED") } });
      await db.incidentEvent.create({
        data: { incidentId: params.incidentId, type: "resolved", actor: "system", detail: serializeJsonField({ verified: true }) },
      });
      return;
    }

    if (result.status === "FAILED") {
      await db.incident.update({ where: { id: params.incidentId }, data: { status: transition("VERIFYING", "ESCALATED") } });
      await db.incidentEvent.create({
        data: {
          incidentId: params.incidentId,
          type: "status_changed",
          actor: "system",
          detail: serializeJsonField({ from: "VERIFYING", to: "ESCALATED", reason: "verification failed" }),
        },
      });
      return;
    }

    // RETRYING
    if (attempt < MAX_VERIFY_ATTEMPTS) await sleep(VERIFY_RETRY_DELAY_MS);
  }

  await db.incident.update({ where: { id: params.incidentId }, data: { status: transition("VERIFYING", "ESCALATED") } });
  await db.incidentEvent.create({
    data: {
      incidentId: params.incidentId,
      type: "status_changed",
      actor: "system",
      detail: serializeJsonField({ from: "VERIFYING", to: "ESCALATED", reason: "verification did not converge" }),
    },
  });
}
