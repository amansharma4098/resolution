import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository } from "@resolution/database";
import { createSecretProvider, type SecretProvider } from "@resolution/credentials";
import type { Env } from "./env";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerAuthRoutes } from "./routes/auth";
import { registerOrganizationRoutes } from "./routes/organizations";
import { registerCredentialRoutes } from "./routes/credentials";
import { registerMapServerRoutes } from "./routes/map-servers";
import { registerIntegrationRoutes } from "./routes/integrations";
import "./types";

export interface BuildAppOptions {
  db: PrismaClient;
  env: Env;
  /** Injectable for tests (an in-memory fake) — defaults to the real provider selected by
   *  env.SECRET_PROVIDER (see packages/credentials/src/factory.ts). */
  secretProvider?: SecretProvider;
}

export async function buildApp({ db, env, secretProvider }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger:
      env.NODE_ENV === "test"
        ? false
        : { level: env.NODE_ENV === "production" ? "info" : "debug" },
    // Never let an unvalidated body crash the process silently — Fastify's default is
    // already to 400 on malformed JSON, this just keeps it explicit.
    onProtoPoisoning: "remove",
  });

  const resolvedSecretProvider =
    secretProvider ??
    createSecretProvider(env.SECRET_PROVIDER, { masterKey: env.ENCRYPTION_MASTER_KEY });
  const organizationRepository = new OrganizationRepository(db);

  // Request IDs threaded through logs and returned to the client — ARCHITECTURE.md §11.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  registerErrorHandler(app);

  await app.register(cookie);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    // Rate-limit per-IP by default; per-org limiting for authenticated, high-volume
    // routes (webhooks, incident ingestion) is added alongside those routes in later
    // phases rather than globally here.
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  await app.register(
    async (instance) => {
      registerAuthRoutes(instance, { db, env });
    },
    { prefix: "/api/auth" },
  );

  await app.register(
    async (instance) => {
      registerOrganizationRoutes(instance, { db, env });
    },
    { prefix: "/api/organizations" },
  );

  await app.register(
    async (instance) => {
      registerCredentialRoutes(instance, {
        db,
        env,
        secretProvider: resolvedSecretProvider,
        organizationRepository,
      });
    },
    { prefix: "/api/credentials" },
  );

  await app.register(
    async (instance) => {
      registerMapServerRoutes(instance, { db, env, organizationRepository });
    },
    { prefix: "/api/map-servers" },
  );

  await app.register(
    async (instance) => {
      registerIntegrationRoutes(instance, { db, env, organizationRepository });
    },
    { prefix: "/api/integrations" },
  );

  return app;
}
