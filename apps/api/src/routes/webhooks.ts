import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { CreditWalletRepository, IntegrationRepository, auditLogWriter } from "@resolution/database";
import { GenericWebhookPayloadSchema, verifyWebhookSecret } from "@resolution/integrations";
import { findCreditPack, verifyStripeSignature } from "@resolution/billing";
import { writeAuditLog } from "@resolution/security";
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
 * Public webhook receivers — no session, no X-Tenant-Id header. The integrationId in
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
  const { db, env, queue } = deps;
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

  // The generic connector — no vendor to mirror, so this *is* the shape (docs/webhooks.md).
  // Validated fully with GenericWebhookPayloadSchema before the 202, unlike Jira/ServiceNow
  // above (which only sanity-check a couple of fields): those are documented third-party
  // shapes the source system controls, so a webhook event this platform doesn't care about
  // is expected and silently ignored downstream; here, a caller integrating directly
  // against *our* schema benefits far more from immediate, specific feedback than from a
  // 202 that silently produces no incident.
  router.post("/webhook/:integrationId", async (c) => {
    const integrationId = c.req.param("integrationId");
    const integration = await IntegrationRepository.findByIdUnscoped(db, integrationId);
    if (!integration || integration.type !== "WEBHOOK") throw new NotFoundError("Not found");
    verifySecretOrThrow(integration.config.webhookSecret, c.req.header("x-webhook-secret"));

    const rawBody = await c.req.text();
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }
    const parsed = GenericWebhookPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Payload doesn't match the expected shape — see docs/webhooks.md",
            details: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    }

    await queue.send({ source: "WEBHOOK", integrationId, rawBody });
    return c.json({ status: "accepted" }, 202);
  });

  // Datadog's Webhooks integration doesn't send a fixed shape — the customer pastes a JSON
  // template (with Datadog's own $VARIABLE tokens) into Datadog's UI, and Datadog renders
  // and POSTs it verbatim. docs/webhooks.md documents the exact template Resolution expects;
  // this only sanity-checks the fields every alert (regardless of transition) always
  // carries, same rigor as the ServiceNow route above — full transition filtering
  // (Triggered/Re-Triggered vs. Recovered/Warn/…) happens in normalizeDatadogWebhook.
  router.post("/datadog/:integrationId", async (c) => {
    const integrationId = c.req.param("integrationId");
    const integration = await IntegrationRepository.findByIdUnscoped(db, integrationId);
    if (!integration || integration.type !== "DATADOG") throw new NotFoundError("Not found");
    verifySecretOrThrow(integration.config.webhookSecret, c.req.header("x-webhook-secret"));

    const rawBody = await c.req.text();
    let payload: { alert_id?: string; alert_transition?: string; alert_title?: string };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }
    if (!payload.alert_id || !payload.alert_transition || !payload.alert_title) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Missing required fields: alert_id, alert_transition, alert_title — check the webhook payload template in Datadog matches docs/webhooks.md",
          },
        },
        400,
      );
    }

    await queue.send({ source: "DATADOG", integrationId, rawBody });
    return c.json({ status: "accepted" }, 202);
  });

  // Real signature verification (Stripe-Signature header, HMAC-SHA256 — see
  // packages/billing/src/stripe-client.ts's verifyStripeSignature), unlike every source
  // above, which relies on a shared secret because the source system doesn't sign its own
  // requests. A tenant/pack that can't be resolved from the event's own metadata (which
  // this platform set at checkout-session creation — never client-supplied) is logged and
  // ignored rather than erroring, since Stripe retries a non-2xx response and there's
  // nothing productive retrying would fix.
  router.post("/stripe", async (c) => {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new NotFoundError("Not found");

    const rawBody = await c.req.text();
    const valid = await verifyStripeSignature(rawBody, c.req.header("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
    if (!valid) throw new NotFoundError("Not found");

    let event: { type?: string; data?: { object?: Record<string, unknown> } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }, 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data?.object ?? {};
      const metadata = (session.metadata as Record<string, string> | undefined) ?? {};
      const tenantId = metadata.tenantId;
      const pack = metadata.packId ? findCreditPack(metadata.packId) : undefined;
      const sessionId = session.id as string | undefined;
      // Some payment methods settle asynchronously — `checkout.session.completed` can fire
      // before payment_status actually reaches "paid"; crediting on that would be crediting
      // for money not actually received yet.
      const paid = session.payment_status === "paid";

      if (tenantId && pack && sessionId && paid) {
        const walletRepo = new CreditWalletRepository(db, tenantId);
        await walletRepo.getOrCreate();
        if (typeof session.customer === "string") {
          await walletRepo.setStripeCustomerId(session.customer);
        }
        const { alreadyApplied, wallet } = await walletRepo.applyTransaction({
          type: "PURCHASE",
          amount: pack.credits,
          relatedEntityType: "CreditPack",
          relatedEntityId: pack.id,
          stripeCheckoutSessionId: sessionId,
        });
        if (!alreadyApplied) {
          await writeAuditLog(auditLogWriter(db), {
            tenantId,
            actorType: "system",
            action: "billing.purchase_completed",
            targetType: "CreditWallet",
            targetId: wallet.id,
            metadata: { packId: pack.id, credits: pack.credits, stripeCheckoutSessionId: sessionId },
          });
        }
      }
    }

    return c.json({ received: true }, 200);
  });

  return router;
}
