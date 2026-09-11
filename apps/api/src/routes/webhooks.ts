import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { IntegrationRepository } from "@resolution/database";
import { verifyWebhookSecret } from "@resolution/integrations";
import type { Env } from "../env";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";
import type { IncidentIngestionQueue } from "../queue/types";

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
 *
 * ARCHITECTURE.md §10: this does auth + shape validation only and returns 202 immediately
 * — all the actual work (idempotency check, normalization, Incident creation) happens in
 * apps/api/src/queue/consumer.ts, off a real Cloudflare Queue in production (Phase 6). The
 * response therefore never includes an incidentId — that doesn't exist yet at enqueue
 * time; check GET /api/incidents to see it once processed.
 */
export function buildWebhookRoutes(deps: {
  db: PrismaClient;
  env: Env;
  queue: IncidentIngestionQueue;
}): Hono<AppEnv> {
  const { db, queue } = deps;
  const router = new Hono<AppEnv>();

  router.post("/jira/:integrationId", async (c) => {
    const integrationId = c.req.param("integrationId");
    const integration = await IntegrationRepository.findByIdUnscoped(db, integrationId);
    if (!integration || integration.type !== "JIRA") throw new NotFoundError("Not found");
    verifySecretOrThrow(integration.config.webhookSecret, c.req.header("x-webhook-secret"));

    const rawBody = await c.req.text();
    try {
      JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }

    await queue.send({ source: "JIRA", integrationId, rawBody });
    return c.json({ status: "accepted" }, 202);
  });

  router.post("/servicenow/:integrationId", async (c) => {
    const integrationId = c.req.param("integrationId");
    const integration = await IntegrationRepository.findByIdUnscoped(db, integrationId);
    if (!integration || integration.type !== "SERVICENOW") throw new NotFoundError("Not found");
    verifySecretOrThrow(integration.config.webhookSecret, c.req.header("x-webhook-secret"));

    const rawBody = await c.req.text();
    let payload: { number?: string; short_description?: string };
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

    await queue.send({ source: "SERVICENOW", integrationId, rawBody });
    return c.json({ status: "accepted" }, 202);
  });

  return router;
}
