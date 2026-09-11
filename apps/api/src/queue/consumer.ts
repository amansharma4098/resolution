import type { PrismaClient } from "@resolution/database";
import { IncidentRepository, IntegrationRepository, auditLogWriter, serializeJsonField } from "@resolution/database";
import {
  normalizeJiraWebhook,
  normalizeServiceNowWebhook,
  type JiraWebhookPayload,
  type ServiceNowWebhookPayload,
} from "@resolution/integrations";
import type { NormalizedIncident } from "@resolution/shared";
import { writeAuditLog } from "@resolution/security";
import type { IngestionQueueMessage } from "./types";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type NormalizedFields = Omit<NormalizedIncident, "id" | "organizationId" | "createdAt">;

export interface IngestionResult {
  status: "created" | "already_processed" | "already_ingested" | "ignored" | "unknown_integration";
  incidentId?: string;
}

/**
 * The actual ingestion work, run by the Cloudflare Queue consumer (worker.ts's `queue`
 * handler) in production and synchronously by inline-queue.ts in tests/local dev —
 * ARCHITECTURE.md §10: webhook handlers (routes/webhooks.ts) do only auth + shape
 * validation and return immediately; this is the "heavy work [that] runs async off the
 * queue". Cloudflare Queues deliver at-least-once, so this must be safely re-runnable —
 * dedup via WebhookEvent's unique constraint and Incident's own (org+source+externalId)
 * constraint, not by anything the producer does.
 */
export interface ProcessIngestionDeps {
  /** Fired exactly once, right after a genuinely new Incident row is inserted — never on the
   *  already_processed/already_ingested/ignored branches, so a redelivered webhook (Cloudflare
   *  Queues are at-least-once) never enqueues a duplicate investigation. Wired in production
   *  (worker.ts) to enqueue onto the real incident-investigation queue; in tests/local dev
   *  (inline-queue.ts) to run the investigation inline, synchronously, the same way ingestion
   *  itself does. */
  onIncidentCreated?: (evt: { incidentId: string; organizationId: string }) => Promise<void>;
}

export async function processIngestionMessage(
  db: PrismaClient,
  message: IngestionQueueMessage,
  deps: ProcessIngestionDeps = {},
): Promise<IngestionResult> {
  const integration = await IntegrationRepository.findByIdUnscoped(db, message.integrationId);
  if (!integration || integration.type !== message.source) {
    // The webhook route already verified the secret against this exact integration before
    // enqueueing, so reaching an unknown integration here would mean it was deleted
    // between enqueue and processing — log-worthy, not a crash.
    return { status: "unknown_integration" };
  }

  let normalized: NormalizedFields | null;
  let externalId: string;
  try {
    if (message.source === "JIRA") {
      const payload: JiraWebhookPayload = JSON.parse(message.rawBody);
      externalId = payload.issue?.key ?? "unknown";
      normalized = normalizeJiraWebhook(payload);
    } else {
      const payload: ServiceNowWebhookPayload = JSON.parse(message.rawBody);
      externalId = payload.number;
      normalized = normalizeServiceNowWebhook(payload);
    }
  } catch {
    // Malformed JSON should never reach here (the webhook route validates it before
    // enqueueing), but fail closed rather than throw if it somehow does.
    return { status: "ignored" };
  }

  const eventHash = await sha256Hex(message.rawBody);
  const existingEvent = await db.webhookEvent.findUnique({
    where: { source_externalId_eventHash: { source: message.source, externalId, eventHash } },
  });
  if (existingEvent) {
    return { status: "already_processed" };
  }

  await db.webhookEvent.create({
    data: {
      organizationId: integration.organizationId,
      source: message.source,
      externalId,
      eventHash,
      payload: message.rawBody,
      processedAt: new Date(),
    },
  });

  if (!normalized) {
    return { status: "ignored" };
  }

  const incidents = new IncidentRepository(db, integration.organizationId);
  const existingIncident = await incidents.findByExternalId(message.source, normalized.externalId);
  if (existingIncident) {
    return { status: "already_ingested", incidentId: existingIncident.id };
  }

  const incident = await incidents.create({ ...normalized, integrationId: integration.id });

  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: "ingested",
      actor: "system",
      detail: serializeJsonField({ source: message.source, externalId: incident.externalId }),
    },
  });

  await writeAuditLog(auditLogWriter(db), {
    organizationId: integration.organizationId,
    actorType: "system",
    action: "incident.ingested",
    targetType: "Incident",
    targetId: incident.id,
    metadata: { source: message.source, externalId: incident.externalId },
  });

  await deps.onIncidentCreated?.({ incidentId: incident.id, organizationId: integration.organizationId });

  return { status: "created", incidentId: incident.id };
}
