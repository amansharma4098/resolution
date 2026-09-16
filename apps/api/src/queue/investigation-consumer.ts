import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  IncidentEvidenceRepository,
  RootCauseAnalysisRepository,
  MapServerRepository,
  CredentialRepository,
  auditLogWriter,
  serializeJsonField,
} from "@resolution/database";
import {
  getMapServerProvider,
  resolveCapability,
  type AnyCapability,
  type MapServerContext,
} from "@resolution/map-servers";
import { createLlmClient, type LlmClient } from "@resolution/ai";
import {
  runInvestigationAgent,
  InvestigationIncompleteError,
  transition,
  type AvailableCapability,
} from "@resolution/agents";
import { writeAuditLog } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import type { InvestigationQueueMessage } from "./types";
import { findSimilarIncidentSummaries } from "../lib/similar-incidents";

export interface InvestigationRunnerConfig {
  mockMode: boolean;
  anthropicApiKey?: string;
  anthropicModel?: string;
  secretProvider: SecretProvider;
  /** Test-only seam — when set, used instead of building one from mockMode/anthropicApiKey
   *  via packages/ai's factory. Exists because the escalation path (agent can't converge
   *  within maxIterations, or a refusal) is hard to provoke naturally through the
   *  deterministic mock client, which always converges within two turns by design. */
  llmClient?: LlmClient;
  /** Fired exactly once, right after a successful RCA_COMPLETE transition — mirrors
   *  consumer.ts's onIncidentCreated hook one stage over. Wired in production to enqueue
   *  onto the remediation queue; never fired on the escalation branch (nothing to
   *  remediate without a completed RCA). */
  onRcaCompleted?: (evt: { incidentId: string; tenantId: string }) => Promise<void>;
}

/**
 * The Investigation/RCA agent's entry point, run by the Cloudflare Queue consumer
 * (worker.ts's `queue` export) in production and synchronously by
 * inline-investigation-queue.ts in tests/local dev — same pattern as
 * queue/consumer.ts's ingestion path. Cloudflare Queues deliver at-least-once, so this must
 * be safely re-runnable: the `status !== "NEW"` guard below is the dedup, not a unique
 * constraint, because — unlike ingestion — running this twice wouldn't create a duplicate
 * row so much as run a real (billed) LLM investigation twice.
 */
export async function processInvestigationMessage(
  db: PrismaClient,
  config: InvestigationRunnerConfig,
  message: InvestigationQueueMessage,
): Promise<void> {
  const incidents = new IncidentRepository(db, message.tenantId);
  const incident = await incidents.findById(message.incidentId);
  if (!incident) return; // deleted between enqueue and processing — nothing to do

  if (incident.status !== "NEW") return;

  const mapServers = new MapServerRepository(db, message.tenantId);
  const credentials = new CredentialRepository(db, message.tenantId);
  const evidenceRepo = new IncidentEvidenceRepository(db);
  const rcaRepo = new RootCauseAnalysisRepository(db);

  const allMapServers = await mapServers.list();

  const contextFor = async (mapServerId: string): Promise<MapServerContext> => {
    const server = await mapServers.findById(mapServerId);
    if (!server || server.config.disabled)
      throw new Error("Connection is disabled or no longer exists");
    let credential: Record<string, unknown> = {};
    if (server?.credentialId) {
      const credentialRow = await credentials.findUsableById(server.credentialId);
      if (!credentialRow) throw new Error("Credential is missing, expired or revoked");
      if (credentialRow) {
        credential = await config.secretProvider.decrypt(credentialRow.encryptedData, {
          tenantId: message.tenantId,
        });
      }
    }
    return {
      tenantId: message.tenantId,
      mapServerId,
      environment: server?.environments[0] ?? "default",
      credential,
      config: server?.config ?? {},
      requestId: crypto.randomUUID(),
    };
  };

  const availableCapabilities: AvailableCapability[] = [];
  for (const server of allMapServers) {
    if (server.config.disabled) continue;
    if (incident.environment && !server.environments.includes(incident.environment)) continue;
    const provider = getMapServerProvider(server.type);
    if (!provider) continue;
    const capabilityRows = await mapServers.listCapabilities(server.id);
    // Investigation only ever sees read-only capabilities — a `mutating: true` capability
    // (restart a pipeline, roll back a deploy, ...) belongs to Phase 8's remediation flow,
    // gated by the automation policy engine and human approval, never called during
    // read-only investigation regardless of whether an org has enabled it.
    const readOnlyRows = capabilityRows.filter((r) => r.enabled && !r.mutating);
    if (readOnlyRows.length === 0) continue;
    const ctx = await contextFor(server.id);
    for (const row of readOnlyRows) {
      const capability = await resolveCapability(provider, ctx, row.key);
      if (capability && !capability.mutating) {
        availableCapabilities.push({
          mapServerId: server.id,
          mapServerType: server.type,
          capability,
        });
      }
    }
  }

  const llmClient =
    config.llmClient ??
    createLlmClient({
      mockMode: config.mockMode,
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
    });

  const claimed = await db.incident.updateMany({
    where: { id: incident.id, tenantId: message.tenantId, status: "NEW" },
    data: { status: transition(incident.status, "INVESTIGATING") },
  });
  if (!claimed.count) return;
  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: "status_changed",
      actor: "agent",
      detail: serializeJsonField({ from: incident.status, to: "INVESTIGATING" }),
    },
  });

  const similar = await findSimilarIncidentSummaries(db, message.tenantId, incident);

  try {
    const result = await runInvestigationAgent(
      {
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        priority: incident.priority,
        source: incident.source,
        service: incident.service,
        environment: incident.environment,
        similarIncidents: similar.map((s) => ({
          title: s.title,
          service: s.service,
          rootCause: s.rootCause,
          actionTaken: s.actionTaken,
          outcome: s.outcome,
        })),
      },
      {
        llmClient,
        availableCapabilities,
        contextFor: async (mapServerId: string, capability: AnyCapability) => {
          const rows = await mapServers.listCapabilities(mapServerId);
          if (!rows.some((r) => r.key === capability.key && r.enabled && !r.mutating))
            throw new Error("Investigation capability is no longer enabled for read access");
          return contextFor(mapServerId);
        },
        recordEvidence: async (entry) => {
          const row = await evidenceRepo.create({
            incidentId: incident.id,
            type: "API_RESPONSE",
            source: entry.mapServerId,
            capabilityKey: entry.capabilityKey,
            summary: entry.summary,
            payload: entry.payload,
          });
          return row.id;
        },
      },
    );

    await rcaRepo.create(incident.id, result.rca);
    await db.incident.update({
      where: { id: incident.id },
      data: { status: transition("INVESTIGATING", "RCA_COMPLETE") },
    });
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "rca_completed",
        actor: "agent",
        detail: serializeJsonField({
          confidence: result.rca.confidence,
          toolCallCount: result.toolCallCount,
          claimCount: result.rca.claims.length,
          mock: llmClient.isMock,
        }),
      },
    });
    await writeAuditLog(auditLogWriter(db), {
      tenantId: message.tenantId,
      actorType: "agent",
      action: "incident.rca_completed",
      targetType: "Incident",
      targetId: incident.id,
      metadata: {
        confidence: result.rca.confidence,
        toolCallCount: result.toolCallCount,
        mock: llmClient.isMock,
      },
    });
    if (config.onRcaCompleted) {
      try {
        await config.onRcaCompleted({ incidentId: incident.id, tenantId: message.tenantId });
        await db.incident.update({
          where: { id: incident.id },
          data: { remediationDispatchedAt: new Date() },
        });
      } catch {
        /* The scheduler retries undispatched RCA_COMPLETE incidents. */
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.incident.update({
      where: { id: incident.id },
      data: { status: transition("INVESTIGATING", "ESCALATED") },
    });
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "status_changed",
        actor: "agent",
        detail: serializeJsonField({ from: "INVESTIGATING", to: "ESCALATED", reason }),
      },
    });
    await writeAuditLog(auditLogWriter(db), {
      tenantId: message.tenantId,
      actorType: "agent",
      action: "incident.investigation_failed",
      targetType: "Incident",
      targetId: incident.id,
      metadata: { reason, incomplete: err instanceof InvestigationIncompleteError },
    });
  }
}
