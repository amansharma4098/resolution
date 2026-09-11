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
import { getMapServerProvider, type AnyCapability, type MapServerContext } from "@resolution/map-servers";
import { createLlmClient, type LlmClient } from "@resolution/ai";
import { runInvestigationAgent, InvestigationIncompleteError, transition, type AvailableCapability } from "@resolution/agents";
import { writeAuditLog } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import type { InvestigationQueueMessage } from "./types";

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
  const incidents = new IncidentRepository(db, message.organizationId);
  const incident = await incidents.findById(message.incidentId);
  if (!incident) return; // deleted between enqueue and processing — nothing to do

  if (incident.status !== "NEW") return;

  const mapServers = new MapServerRepository(db, message.organizationId);
  const credentials = new CredentialRepository(db, message.organizationId);
  const evidenceRepo = new IncidentEvidenceRepository(db);
  const rcaRepo = new RootCauseAnalysisRepository(db);

  const allMapServers = await mapServers.list();
  const availableCapabilities: AvailableCapability[] = [];
  for (const server of allMapServers) {
    const provider = getMapServerProvider(server.type);
    if (!provider) continue;
    const capabilityRows = await mapServers.listCapabilities(server.id);
    // Investigation only ever sees read-only capabilities — a `mutating: true` capability
    // (restart a pipeline, roll back a deploy, ...) belongs to Phase 8's remediation flow,
    // gated by the automation policy engine and human approval, never called during
    // read-only investigation regardless of whether an org has enabled it.
    for (const row of capabilityRows.filter((r) => r.enabled && !r.mutating)) {
      const capability = provider.capabilities.find((c) => c.key === row.key);
      if (capability) {
        availableCapabilities.push({ mapServerId: server.id, mapServerType: server.type, capability });
      }
    }
  }

  const contextFor = async (mapServerId: string): Promise<MapServerContext> => {
    const server = allMapServers.find((s) => s.id === mapServerId);
    let credential: Record<string, unknown> = {};
    if (server?.credentialId) {
      const credentialRow = await credentials.findById(server.credentialId);
      if (credentialRow) {
        credential = await config.secretProvider.decrypt(credentialRow.encryptedData, {
          organizationId: message.organizationId,
        });
      }
    }
    return {
      organizationId: message.organizationId,
      mapServerId,
      environment: server?.environments[0] ?? "default",
      credential,
      requestId: crypto.randomUUID(),
    };
  };

  const llmClient =
    config.llmClient ??
    createLlmClient({
      mockMode: config.mockMode,
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
    });

  await db.incident.update({
    where: { id: incident.id },
    data: { status: transition(incident.status, "INVESTIGATING") },
  });
  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: "status_changed",
      actor: "agent",
      detail: serializeJsonField({ from: incident.status, to: "INVESTIGATING" }),
    },
  });

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
      },
      {
        llmClient,
        availableCapabilities,
        contextFor: (mapServerId: string, _capability: AnyCapability) => contextFor(mapServerId),
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
      organizationId: message.organizationId,
      actorType: "agent",
      action: "incident.rca_completed",
      targetType: "Incident",
      targetId: incident.id,
      metadata: { confidence: result.rca.confidence, toolCallCount: result.toolCallCount, mock: llmClient.isMock },
    });
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
      organizationId: message.organizationId,
      actorType: "agent",
      action: "incident.investigation_failed",
      targetType: "Incident",
      targetId: incident.id,
      metadata: { reason, incomplete: err instanceof InvestigationIncompleteError },
    });
  }
}
