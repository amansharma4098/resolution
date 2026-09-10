import { z } from "zod";

/**
 * Fail fast on a missing/malformed env var at boot, not on the first request that happens
 * to touch it. `JWT_SECRET` has no default on purpose — a real deployment must set one;
 * only local dev falls back (see `.env.example`).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .default("dev-only-insecure-secret-change-me-before-deploying-32ch"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  MOCK_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration — see stderr for details");
  }
  return parsed.data;
}
