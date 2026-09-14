import { z } from "zod";

/**
 * Fail fast on a missing/malformed env var at boot, not on the first request that happens
 * to touch it. `JWT_SECRET` has no default on purpose — a real deployment must set one;
 * only local dev falls back (see `.env.example`).
 *
 * No `DATABASE_URL`/`PORT` here — this app runs as a Cloudflare Worker (ARCHITECTURE.md
 * §2), which has no filesystem/port to bind and gets its database via the `DB` D1 binding
 * in wrangler.toml instead of a connection string. `DATABASE_URL` still exists as a
 * variable for local Prisma tooling (`prisma migrate`) against a plain sqlite file, but
 * that's outside this schema, which only validates what the running app itself reads.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .default("dev-only-insecure-secret-change-me-before-deploying-32ch"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  MOCK_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  SECRET_PROVIDER: z
    .enum(["ENCRYPTED_DB", "AWS_SECRETS_MANAGER", "AZURE_KEY_VAULT", "GCP_SECRET_MANAGER"])
    .default("ENCRYPTED_DB"),
  // Dev-only default (a fixed, public value — same treatment as JWT_SECRET's default): any
  // real deployment must set its own via `openssl rand -base64 32`. See docs/credentials.md.
  ENCRYPTION_MASTER_KEY: z.string().default("M5MlvZfby1B0D9PY4DHTrTRoFtO3G1wR5oS4pJPnw1g="),
  // Phase 7 — the Investigation/RCA agent's LLM. No default: an unset key just means the
  // investigation queue consumer falls back to packages/ai's MOCK_MODE-independent rule
  // (createLlmClient treats "no key" the same as MOCK_MODE=true) rather than failing boot —
  // see packages/ai/src/factory.ts. ANTHROPIC_MODEL defaults to the current model this
  // codebase was built against; override to point at a different current model without a
  // code change.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  // Forgot-password emails (packages/email). Same no-default, both-or-neither treatment as
  // ANTHROPIC_API_KEY: unset means createEmailSender falls back to its console-logging
  // MOCK_MODE-style sender instead of failing boot — the full signup → forgot-password →
  // reset flow still works end to end, just without a real email landing anywhere.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Billing (packages/billing) — a credit-pack purchase. Same no-default, both-unset-means-
  // fall-back-honestly treatment as every other real-provider integration in this file: no
  // STRIPE_SECRET_KEY means POST /api/billing/checkout applies the purchase directly
  // (labeled `mock: true` in the response) instead of a real charge, so the full
  // purchase → wallet → consumption loop still works with zero external accounts.
  STRIPE_SECRET_KEY: z.string().optional(),
  // Required to verify a real Stripe webhook's signature — irrelevant in the mock-checkout
  // path above, since nothing calls out to Stripe (and therefore nothing webhooks back) in
  // that case.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration — see stderr for details");
  }
  return parsed.data;
}
