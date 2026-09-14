import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, loadEnvForTest, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("billing — mock checkout (no STRIPE_SECRET_KEY configured)", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("starts at a zero balance with the three real packs listed", async () => {
    const res = await req(app, "/api/billing/wallet", { cookie, tenantId });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.wallet).toMatchObject({ balance: 0, hasPaymentMethod: false });
    expect(body.packs.map((p: { id: string }) => p.id).sort()).toEqual(["growth", "scale", "starter"]);
    expect(body.transactions).toEqual([]);
  });

  it("a MEMBER cannot view the wallet — Owner-only", async () => {
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie,
      tenantId,
      body: { email: "member@example.com", role: "MEMBER" },
    });
    const { temporaryPassword } = await jsonOf(added);
    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "member@example.com", password: temporaryPassword },
    });
    const memberCookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const res = await req(app, "/api/billing/wallet", { cookie: memberCookie, tenantId });
    expect(res.status).toBe(403);
  });

  it("an ADMIN (not just MEMBER) also cannot manage billing — Owner-only, stricter than Admin", async () => {
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie,
      tenantId,
      body: { email: "admin@example.com", role: "ADMIN" },
    });
    const { temporaryPassword } = await jsonOf(added);
    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "admin@example.com", password: temporaryPassword },
    });
    const adminCookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const res = await req(app, "/api/billing/checkout", {
      method: "POST",
      cookie: adminCookie,
      tenantId,
      body: { packId: "starter" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown pack id", async () => {
    const res = await req(app, "/api/billing/checkout", {
      method: "POST",
      cookie,
      tenantId,
      body: { packId: "not-a-real-pack" },
    });
    expect(res.status).toBe(400);
  });

  it("checkout without a configured Stripe key applies the purchase directly, labeled mock", async () => {
    const res = await req(app, "/api/billing/checkout", {
      method: "POST",
      cookie,
      tenantId,
      body: { packId: "starter" },
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.mock).toBe(true);
    expect(body.wallet.balance).toBe(5_000);

    const wallet = await req(app, "/api/billing/wallet", { cookie, tenantId });
    const walletBody = await jsonOf(wallet);
    expect(walletBody.wallet.balance).toBe(5_000);
    expect(walletBody.transactions).toHaveLength(1);
    expect(walletBody.transactions[0]).toMatchObject({ type: "PURCHASE", amount: 5_000, balanceAfter: 5_000 });
  });

  it("two purchases accumulate", async () => {
    await req(app, "/api/billing/checkout", { method: "POST", cookie, tenantId, body: { packId: "starter" } });
    await req(app, "/api/billing/checkout", { method: "POST", cookie, tenantId, body: { packId: "growth" } });

    const wallet = await req(app, "/api/billing/wallet", { cookie, tenantId });
    expect((await jsonOf(wallet)).wallet.balance).toBe(5_000 + 20_000);
  });
});

describe("billing — real Stripe checkout (STRIPE_SECRET_KEY configured)", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ app } = buildTestApp({ env: loadEnvForTest({ STRIPE_SECRET_KEY: "sk_test_123" }) }));
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1", customer: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns a real checkout URL instead of applying the purchase directly", async () => {
    const res = await req(app, "/api/billing/checkout", {
      method: "POST",
      cookie,
      tenantId,
      body: { packId: "growth" },
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.mock).toBe(false);
    expect(body.checkoutUrl).toBe("https://checkout.stripe.com/cs_test_1");

    // Balance is untouched until the webhook confirms payment — never credited on the
    // strength of merely creating a Checkout Session.
    const wallet = await req(app, "/api/billing/wallet", { cookie, tenantId });
    expect((await jsonOf(wallet)).wallet.balance).toBe(0);
  });

  it("prices the discounted pack correctly in the Stripe request", async () => {
    await req(app, "/api/billing/checkout", { method: "POST", cookie, tenantId, body: { packId: "starter" } });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("8000"); // $80, 20% off $100
    expect(body.get("metadata[tenantId]")).toBe(tenantId);
    expect(body.get("metadata[packId]")).toBe("starter");
  });
});
