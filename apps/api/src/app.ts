import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { PrismaClient } from "@resolution/database";
import type { Env } from "./env";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerAuthRoutes } from "./routes/auth";
import { registerOrganizationRoutes } from "./routes/organizations";
import "./types";

export interface BuildAppOptions {
  db: PrismaClient;
  env: Env;
}

export async function buildApp({ db, env }: BuildAppOptions): Promise<FastifyInstance> {
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

  return app;
}
