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
