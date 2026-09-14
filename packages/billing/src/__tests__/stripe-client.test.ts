import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StripeApiError, StripeClient, verifyStripeSignature } from "../stripe-client";

describe("StripeClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates a checkout session with the correct line item and metadata, form-encoded", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_123", url: "https://checkout.stripe.com/cs_123", customer: null }), {
        status: 200,
      }),
    );
    const client = new StripeClient("sk_test_123");
    const session = await client.createCheckoutSession({
      productName: "Growth — 20,000 credits",
      priceCents: 32_000,
      currency: "usd",
      successUrl: "https://app.example.com/billing?success=1",
      cancelUrl: "https://app.example.com/billing?canceled=1",
      clientReferenceId: "tenant-1",
      metadata: { tenantId: "tenant-1", packId: "growth", credits: "20000" },
    });

    expect(session.id).toBe("cs_123");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_123");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("mode")).toBe("payment");
    expect(body.get("client_reference_id")).toBe("tenant-1");
    expect(body.get("metadata[tenantId]")).toBe("tenant-1");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("32000");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe("Growth — 20,000 credits");
    expect(body.get("customer_creation")).toBe("always");
  });

  it("reuses an existing Stripe customer instead of creating a new one", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "cs_1", url: null, customer: "cus_1" }), { status: 200 }));
    const client = new StripeClient("sk_test_123");
    await client.createCheckoutSession({
      productName: "Starter",
      priceCents: 8_000,
      currency: "usd",
      successUrl: "https://a",
      cancelUrl: "https://b",
      clientReferenceId: "tenant-1",
      metadata: {},
      customerId: "cus_1",
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("customer_creation")).toBeNull();
  });

  it("throws StripeApiError with the status code on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = new StripeClient("sk_test_123");
    await expect(
      client.createCheckoutSession({
        productName: "x",
        priceCents: 100,
        currency: "usd",
        successUrl: "https://a",
        cancelUrl: "https://b",
        clientReferenceId: "t",
        metadata: {},
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.createCheckoutSession({
        productName: "x",
        priceCents: 100,
        currency: "usd",
        successUrl: "https://a",
        cancelUrl: "https://b",
        clientReferenceId: "t",
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(StripeApiError);
  });
});

describe("verifyStripeSignature", () => {
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

  it("accepts a correctly-signed, fresh payload", async () => {
    const secret = "whsec_test";
    const body = '{"type":"checkout.session.completed"}';
    const now = Math.floor(Date.now() / 1000);
    const sig = await sign(secret, now, body);
    const valid = await verifyStripeSignature(body, `t=${now},v1=${sig}`, secret);
    expect(valid).toBe(true);
  });

  it("rejects a wrong signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = await verifyStripeSignature("{}", `t=${now},v1=deadbeef`, "whsec_test");
    expect(valid).toBe(false);
  });

  it("rejects a payload that's been tampered with after signing", async () => {
    const secret = "whsec_test";
    const now = Math.floor(Date.now() / 1000);
    const sig = await sign(secret, now, '{"amount":100}');
    const valid = await verifyStripeSignature('{"amount":999999}', `t=${now},v1=${sig}`, secret);
    expect(valid).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", async () => {
    const secret = "whsec_test";
    const body = "{}";
    const old = Math.floor(Date.now() / 1000) - 10_000;
    const sig = await sign(secret, old, body);
    const valid = await verifyStripeSignature(body, `t=${old},v1=${sig}`, secret);
    expect(valid).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    expect(await verifyStripeSignature("{}", undefined, "whsec_test")).toBe(false);
    expect(await verifyStripeSignature("{}", null, "whsec_test")).toBe(false);
  });

  it("rejects a malformed signature header", async () => {
    expect(await verifyStripeSignature("{}", "not-a-real-header", "whsec_test")).toBe(false);
  });
});
