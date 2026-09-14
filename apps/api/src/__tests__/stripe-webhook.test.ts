import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, loadEnvForTest, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const WEBHOOK_SECRET = "whsec_test_123";

function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        customer: "cus_test_1",
        payment_status: "paid",
        metadata: { tenantId: "will-be-overridden", packId: "starter", credits: "5000" },
        ...overrides,
      },
    },
  };
}

async function postStripeWebhook(app: Hono<AppEnv>, event: unknown) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sign(WEBHOOK_SECRET, timestamp, body);
  return app.request("/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
    body,
  });
}

describe("Stripe webhook", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp({ env: loadEnvForTest({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }) }));
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("404s when no STRIPE_WEBHOOK_SECRET is configured on this deployment", async () => {
    const { app: unconfiguredApp } = buildTestApp();
    const res = await postStripeWebhook(unconfiguredApp, checkoutCompletedEvent());
    expect(res.status).toBe(404);
  });

  it("rejects a request with no signature header", async () => {
    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(checkoutCompletedEvent({ metadata: { tenantId, packId: "starter" } })),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a forged signature", async () => {
    const res = await app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify(checkoutCompletedEvent({ metadata: { tenantId, packId: "starter" } })),
    });
    expect(res.status).toBe(404);
  });

  it("credits the right tenant's wallet and stores the Stripe customer id", async () => {
    const res = await postStripeWebhook(
      app,
      checkoutCompletedEvent({ metadata: { tenantId, packId: "starter", credits: "5000" } }),
    );
    expect(res.status).toBe(200);

    const wallet = await req(app, "/api/billing/wallet", { cookie, tenantId });
    const body = await jsonOf(wallet);
    expect(body.wallet.balance).toBe(5_000);
    expect(body.wallet.hasPaymentMethod).toBe(true);
    expect(body.transactions[0]).toMatchObject({ type: "PURCHASE", amount: 5_000 });
  });

  it("is idempotent — a redelivered webhook for the same checkout session doesn't double-credit", async () => {
    const event = checkoutCompletedEvent({ metadata: { tenantId, packId: "starter", credits: "5000" } });
    await postStripeWebhook(app, event);
    const second = await postStripeWebhook(app, event);
    expect(second.status).toBe(200);

    const wallet = await req(app, "/api/billing/wallet", { cookie, tenantId });
    expect((await jsonOf(wallet)).wallet.balance).toBe(5_000);
  });

  it("never credits an unpaid session (async payment method still pending)", async () => {
    await postStripeWebhook(
      app,
      checkoutCompletedEvent({ metadata: { tenantId, packId: "starter" }, payment_status: "unpaid" }),
    );
    const wallet = await req(app, "/api/billing/wallet", { cookie, tenantId });
    expect((await jsonOf(wallet)).wallet.balance).toBe(0);
  });

  it("ignores an event type it doesn't handle, without erroring", async () => {
    const res = await postStripeWebhook(app, { type: "customer.created", data: { object: {} } });
    expect(res.status).toBe(200);
  });

  it("ignores a session with no resolvable tenant/pack rather than crashing", async () => {
    const res = await postStripeWebhook(app, checkoutCompletedEvent({ metadata: {} }));
    expect(res.status).toBe(200);
  });
});
