import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  IntegrationRepository,
  auditLogWriter,
  serializeJsonField,
} from "@resolution/database";
import {
  GenericWebhookPayloadSchema,
  normalizeAzureMonitor,
  normalizeDatadogWebhook,
  normalizeGenericWebhook,
  normalizeJiraWebhook,
  normalizeServiceNowWebhook,
  type DatadogWebhookPayload,
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

type NormalizedFields = Omit<NormalizedIncident, "id" | "tenantId" | "createdAt">;

export interface IngestionResult {
  status: "created" | "already_processed" | "already_ingested" | "ignored" | "unknown_integration";
  incidentId?: string;
}

/** At-least-once ingestion; event identity is scoped to a tenant and source instance. */
export interface ProcessIngestionDeps {
  /** May be repeated after an uncertain queue send. The consumer must atomically claim NEW. */
  onIncidentCreated?: (evt: { incidentId: string; tenantId: string }) => Promise<void>;
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

  if (integration.config.disabled === true) return { status: "ignored" };

  let normalized: NormalizedFields | null;
  let externalId: string;
  try {
    if (message.source === "JIRA") {
      const payload: JiraWebhookPayload = JSON.parse(message.rawBody);
      externalId = payload.issue?.key ?? "unknown";
      normalized = normalizeJiraWebhook(payload);
    } else if (message.source === "SERVICENOW") {
      const payload: ServiceNowWebhookPayload = JSON.parse(message.rawBody);
      externalId = payload.number;
      normalized = normalizeServiceNowWebhook(payload);
    } else if (message.source === "AZURE_MONITOR") {
      normalized = normalizeAzureMonitor(JSON.parse(message.rawBody));
      externalId = normalized?.externalId ?? "recovered";
    } else if (message.source === "DATADOG") {
      const payload: DatadogWebhookPayload = JSON.parse(message.rawBody);
      externalId = payload.alert_id;
      // Recovered/Warn/No Data/etc. transitions are expected and normal — not errors, just
      // not a page — normalizeDatadogWebhook returns null for those; falls through to the
      // same "ignored" handling below.
      normalized = normalizeDatadogWebhook(payload);
    } else {
      // The route already validated this against GenericWebhookPayloadSchema before
      // enqueueing (see routes/webhooks.ts) — re-parsing here is defense in depth, not the
      // primary check, same "malformed → ignored, never a crash" fallback as the other two.
      const parsed = GenericWebhookPayloadSchema.safeParse(JSON.parse(message.rawBody));
      if (!parsed.success) return { status: "ignored" };
      externalId = parsed.data.externalId;
      normalized = normalizeGenericWebhook(parsed.data);
    }
  } catch {
    // Malformed JSON should never reach here (the webhook route validates it before
    // enqueueing), but fail closed rather than throw if it somehow does.
    return { status: "ignored" };
  }

  const eventHash = await sha256Hex(`${integration.tenantId}:${integration.id}:${message.rawBody}`);
  const existingEvent = await db.webhookEvent.findUnique({
    where: { source_externalId_eventHash: { source: message.source, externalId, eventHash } },
  });
  if (existingEvent) {
    return { status: "already_processed" };
  }

  if (!normalized) {
    return { status: "ignored" };
  }

  const incidents = new IncidentRepository(db, integration.tenantId);
  const existingIncident = await incidents.findByExternalId(
    message.source,
    normalized.externalId,
    integration.id,
  );
  let incident = existingIncident;
  let created = false;
  if (!incident) {
    try {
      incident = await incidents.create({
        ...normalized,
        integrationId: integration.id,
        environment:
          normalized.environment ??
          (typeof integration.config.environment === "string"
            ? integration.config.environment
            : undefined),
        service:
          normalized.service ??
          (typeof integration.config.service === "string" ? integration.config.service : undefined),
      });
      created = true;
    } catch (error) {
      incident = await incidents.findByExternalId(
        message.source,
        normalized.externalId,
        integration.id,
      );
      if (!incident) throw error;
    }
  }
  if (!created) {
    await db.incident.update({
      where: { id: incident.id },
      data: {
        title: normalized.title,
        description: normalized.description,
        severity: normalized.severity,
        priority: normalized.priority,
        metadata: serializeJsonField({ ...incident.metadata, ...normalized.metadata }),
      },
    });
  }
  if (created) {
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "ingested",
        actor: "system",
        detail: serializeJsonField({ source: message.source, externalId: incident.externalId }),
      },
    });

    await writeAuditLog(auditLogWriter(db), {
      tenantId: integration.tenantId,
      actorType: "system",
      action: "incident.ingested",
      targetType: "Incident",
      targetId: incident.id,
      metadata: { source: message.source, externalId: incident.externalId },
    });
  }
  // At-least-once dispatch: record completion only after the downstream send succeeds.
  // A crash after send may duplicate a message; the investigation consumer atomically claims NEW.
  if (incident.status === "NEW" && deps.onIncidentCreated) {
    await deps.onIncidentCreated({ incidentId: incident.id, tenantId: integration.tenantId });
    await db.incident.update({
      where: { id: incident.id },
      data: { investigationDispatchedAt: new Date() },
    });
  }
  try {
    await db.webhookEvent.create({
      data: {
        tenantId: integration.tenantId,
        source: message.source,
        externalId,
        eventHash,
        payload: message.rawBody,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    if (
      !(await db.webhookEvent.findUnique({
        where: { source_externalId_eventHash: { source: message.source, externalId, eventHash } },
      }))
    )
      throw error;
  }
  return { status: created ? "created" : "already_ingested", incidentId: incident.id };
}
