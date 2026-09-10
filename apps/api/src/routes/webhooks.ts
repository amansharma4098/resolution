import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { IncidentRepository, IntegrationRepository, auditLogWriter } from "@resolution/database";
import { normalizeJiraWebhook, verifyWebhookSecret, type JiraWebhookPayload } from "@resolution/integrations";
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

/**
 * Public webhook receivers — no session, no X-Organization-Id header. The integrationId in
 * the URL identifies which org's Integration this belongs to; the X-Webhook-Secret header
 * (checked in constant time) is what actually authenticates the request, since Jira Cloud's
 * native webhooks don't sign their payloads — see packages/integrations/src/webhook-secret.ts.
 *
 * Webhook handlers return as soon as the work is durably recorded (ARCHITECTURE.md §10)
 * — with no queue yet (Phase 6 adds Cloudflare Queues), that means processing happens
 * inline before responding rather than being handed off, which is a known, documented
 * simplification, not a design endpoint.
 */
export function buildWebhookRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db } = deps;
  const router = new Hono<AppEnv>();

  router.post("/jira/:integrationId", async (c) => {
    const integration = await IntegrationRepository.findByIdUnscoped(db, c.req.param("integrationId"));
    // 404, not 401/403 — never confirm to an unauthenticated caller that a given
    // integrationId exists, same discipline as tenant-context's non-member handling.
    if (!integration || integration.type !== "JIRA") throw new NotFoundError("Not found");

    const expectedSecret = integration.config.webhookSecret;
    if (typeof expectedSecret !== "string" || !verifyWebhookSecret(c.req.header("x-webhook-secret"), expectedSecret)) {
      throw new NotFoundError("Not found");
    }

    const rawBody = await c.req.text();
    let payload: JiraWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }

    const externalId = payload.issue?.key ?? "unknown";
    const eventHash = await sha256Hex(rawBody);

    const existingEvent = await db.webhookEvent.findUnique({
      where: { source_externalId_eventHash: { source: "JIRA", externalId, eventHash } },
    });
    if (existingEvent) {
      // Already processed this exact payload — idempotent no-op, not an error.
      return c.json({ status: "already_processed" }, 200);
    }

    await db.webhookEvent.create({
      data: {
        organizationId: integration.organizationId,
        source: "JIRA",
        externalId,
        eventHash,
        payload: rawBody,
        processedAt: new Date(),
      },
    });

    const normalized = normalizeJiraWebhook(payload);
    if (!normalized) {
      // A real Jira event we don't act on (e.g. issue_deleted) — recorded above for
      // audit/idempotency, but not an incident.
      return c.json({ status: "ignored" }, 200);
    }

    const incidents = new IncidentRepository(db, integration.organizationId);
    const existingIncident = await incidents.findByExternalId("JIRA", normalized.externalId);
    if (existingIncident) {
      // Same Jira issue re-notified (e.g. issue_updated after issue_created) — merging
      // updates into the existing incident's lifecycle is Phase 6's state machine; for now
      // this is an idempotent no-op rather than a duplicate incident.
      return c.json({ status: "already_ingested", incidentId: existingIncident.id }, 200);
    }

    const incident = await incidents.create({ ...normalized, integrationId: integration.id });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: integration.organizationId,
      actorType: "system",
      action: "incident.ingested",
      targetType: "Incident",
      targetId: incident.id,
      metadata: { source: "JIRA", externalId: incident.externalId },
    });

    return c.json({ status: "created", incidentId: incident.id }, 201);
  });

  return router;
}
