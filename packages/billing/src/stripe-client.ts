/**
 * A thin wrapper over the real Stripe REST API — no SDK, just typed fetch calls, same
 * reasoning as every other external client in this codebase (packages/map-servers'
 * Fabric/Datadog clients, packages/email's Resend sender): this runs inside a Cloudflare
 * Worker, and Stripe's API is well-documented, form-encoded REST — a full SDK buys little
 * for the two things this needs (create a Checkout Session, verify a webhook signature).
 */

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/** Stripe's form-encoding convention for nested objects/arrays: `line_items[0][quantity]=1`,
 *  `metadata[tenantId]=...`. Flattens one level of nesting recursively into that shape —
 *  enough for what this client actually sends. */
function flattenToStripeForm(value: unknown, prefix: string, out: URLSearchParams): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenToStripeForm(item, `${prefix}[${i}]`, out));
  } else if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      flattenToStripeForm(v, prefix ? `${prefix}[${key}]` : key, out);
    }
  } else {
    out.set(prefix, String(value));
  }
}

function toStripeForm(body: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    flattenToStripeForm(value, key, out);
  }
  return out;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
}

export interface CreateCheckoutSessionInput {
  productName: string;
  priceCents: number;
  currency: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
  /** Reuse an existing Stripe Customer if this tenant already has one — avoids creating a
   *  fresh, unlinked customer on every purchase. */
  customerId?: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
}

export class StripeClient {
  constructor(private readonly secretKey: string) {}

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: toStripeForm(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new StripeApiError(`Stripe API ${path} returned ${res.status}: ${errBody.slice(0, 500)}`, res.status);
    }
    return (await res.json()) as T;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const body: Record<string, unknown> = {
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      metadata: input.metadata,
      line_items: [
        {
          quantity: input.quantity ?? 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.priceCents,
            product_data: { name: input.productName },
          },
        },
      ],
    };
    if (input.customerId) {
      body.customer = input.customerId;
    } else {
      // Lets us learn and store the new Customer id from the completed-session webhook,
      // so the *next* purchase (and eventually auto-recharge) can reuse it.
      body.customer_creation = "always";
    }
    return this.request<CheckoutSession>("/checkout/sessions", body);
  }
}

/**
 * Verifies a Stripe webhook's `Stripe-Signature` header — `t=<unix seconds>,v1=<hex hmac>`,
 * where the hmac is `HMAC-SHA256(webhookSecret, "${t}.${rawBody}")`. Implemented with Web
 * Crypto (native to Workers) rather than Stripe's SDK helper, same reasoning as this file's
 * header comment. `toleranceSeconds` guards against a replayed old signature — Stripe's own
 * SDK defaults to 300s (5 minutes); matched here.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value] as const;
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
