import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { IncidentRepository, IntegrationRepository, auditLogWriter } from "@resolution/database";
import {
  normalizeJiraWebhook,
  normalizeServiceNowWebhook,
  verifyWebhookSecret,
  type JiraWebhookPayload,
  type ServiceNowWebhookPayload,
} from "@resolution/integrations";
import type { NormalizedIncident } from "@resolution/shared";
import { writeAuditLog } from "@resolution/security";
import type { Env } from "../env";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Source = "JIRA" | "SERVICENOW";
type NormalizedFields = Omit<NormalizedIncident, "id" | "organizationId" | "createdAt">;

/**
 * Shared by both source-specific handlers below: verify the webhook secret, dedupe via
 * WebhookEvent's unique constraint, and create the Incident (also deduped, via its own
 * org+source+externalId constraint) if this is a genuinely new external issue.
 * ARCHITECTURE.md §10: webhook handlers return as soon as the work is durably recorded —
 * with no queue yet (Phase 6 adds Cloudflare Queues), that means processing happens inline
 * before responding rather than being handed off, a known, documented simplification.
 */
async function ingestWebhook(
  db: PrismaClient,
  source: Source,
  integrationId: string,
  rawBody: string,
  getExternalId: (raw: string) => string,
  normalize: (raw: string) => NormalizedFields | null,
): Promise<{ status: string; incidentId?: string }> {
  const integration = await IntegrationRepository.findByIdUnscoped(db, integrationId);
  // 404, not 401/403 — never confirm to an unauthenticated caller that a given
  // integrationId exists, same discipline as tenant-context's non-member handling.
  if (!integration || integration.type !== source) {
    throw new NotFoundError("Not found");
  }

  const externalId = getExternalId(rawBody);
  const eventHash = await sha256Hex(rawBody);

  const existingEvent = await db.webhookEvent.findUnique({
    where: { source_externalId_eventHash: { source, externalId, eventHash } },
  });
  if (existingEvent) {
    return { status: "already_processed" };
  }

  await db.webhookEvent.create({
    data: {
      organizationId: integration.organizationId,
      source,
      externalId,
      eventHash,
      payload: rawBody,
      processedAt: new Date(),
    },
  });

  const normalized = normalize(rawBody);
  if (!normalized) {
    // A real event we don't act on (e.g. Jira's issue_deleted) — recorded above for
    // audit/idempotency, but not an incident.
    return { status: "ignored" };
  }

  const incidents = new IncidentRepository(db, integration.organizationId);
  const existingIncident = await incidents.findByExternalId(source, normalized.externalId);
  if (existingIncident) {
    // Same external issue re-notified (e.g. an update event after the create event) —
    // merging updates into the existing incident's lifecycle is Phase 6's state machine;
    // for now this is an idempotent no-op rather than a duplicate incident.
    return { status: "already_ingested", incidentId: existingIncident.id };
  }

  const incident = await incidents.create({ ...normalized, integrationId: integration.id });

  await writeAuditLog(auditLogWriter(db), {
    organizationId: integration.organizationId,
    actorType: "system",
    action: "incident.ingested",
    targetType: "Incident",
    targetId: incident.id,
    metadata: { source, externalId: incident.externalId },
  });

  return { status: "created", incidentId: incident.id };
}

function verifySecretOrThrow(configSecret: unknown, provided: string | undefined): void {
  if (typeof configSecret !== "string" || !verifyWebhookSecret(provided, configSecret)) {
    throw new NotFoundError("Not found");
  }
}

/**
 * Public webhook receivers — no session, no X-Organization-Id header. The integrationId in
 * the URL identifies which org's Integration this belongs to; the X-Webhook-Secret header
 * (checked in constant time) is what actually authenticates the request, since neither
 * Jira Cloud's native webhooks nor a ServiceNow Business Rule's outbound REST call sign
 * their payloads — see packages/integrations/src/webhook-secret.ts.
 */
export function buildWebhookRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db } = deps;
  const router = new Hono<AppEnv>();

  router.post("/jira/:integrationId", async (c) => {
    const integration = await IntegrationRepository.findByIdUnscoped(db, c.req.param("integrationId"));
    if (!integration || integration.type !== "JIRA") throw new NotFoundError("Not found");
    verifySecretOrThrow(integration.config.webhookSecret, c.req.header("x-webhook-secret"));

    const rawBody = await c.req.text();
    let payload: JiraWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }

    const result = await ingestWebhook(
      db,
      "JIRA",
      c.req.param("integrationId"),
      rawBody,
      () => payload.issue?.key ?? "unknown",
      () => normalizeJiraWebhook(payload),
    );
    return c.json(result, result.status === "created" ? 201 : 200);
  });

  router.post("/servicenow/:integrationId", async (c) => {
    const integration = await IntegrationRepository.findByIdUnscoped(db, c.req.param("integrationId"));
    if (!integration || integration.type !== "SERVICENOW") throw new NotFoundError("Not found");
    verifySecretOrThrow(integration.config.webhookSecret, c.req.header("x-webhook-secret"));

    const rawBody = await c.req.text();
    let payload: ServiceNowWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }
    if (!payload.number || !payload.short_description) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: "Missing required fields: number, short_description" } },
        400,
      );
    }

    const result = await ingestWebhook(
      db,
      "SERVICENOW",
      c.req.param("integrationId"),
      rawBody,
      () => payload.number,
      () => normalizeServiceNowWebhook(payload),
    );
    return c.json(result, result.status === "created" ? 201 : 200);
  });

  return router;
}
