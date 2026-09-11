import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository } from "@resolution/database";
import { createSecretProvider, type SecretProvider } from "@resolution/credentials";
import type { Env } from "./env";
import type { AppEnv } from "./types";
import { handleError } from "./plugins/error-handler";
import { rateLimit } from "./middleware/rate-limit";
import { buildAuthRoutes } from "./routes/auth";
import { buildOrganizationRoutes } from "./routes/organizations";
import { buildCredentialRoutes } from "./routes/credentials";
import { buildMapServerRoutes } from "./routes/map-servers";
import { buildIntegrationRoutes } from "./routes/integrations";
import { buildIncidentRoutes } from "./routes/incidents";
import { buildAutomationPolicyRoutes } from "./routes/automation-policies";
import { buildAuditLogRoutes } from "./routes/audit-logs";
import { buildMetricsRoutes } from "./routes/metrics";
import { buildWebhookRoutes } from "./routes/webhooks";
import { createInlineIngestionQueue } from "./queue/inline-queue";
import { createInlineInvestigationQueue } from "./queue/inline-investigation-queue";
import { createInlineRemediationQueue } from "./queue/inline-remediation-queue";
import type { IncidentIngestionQueue, IncidentInvestigationQueue, IncidentRemediationQueue } from "./queue/types";

export interface BuildAppOptions {
  db: PrismaClient;
  env: Env;
  /** Injectable for tests (a fresh-keyed real EncryptedDbSecretProvider, or a fake) —
   *  defaults to the real provider selected by env.SECRET_PROVIDER
   *  (see packages/credentials/src/factory.ts). */
  secretProvider?: SecretProvider;
  /** Injectable for tests/local dev — defaults to a synchronous inline stand-in (see
   *  queue/inline-queue.ts). apps/api/src/worker.ts passes the real Cloudflare Queue
   *  binding in production. */
  incidentIngestionQueue?: IncidentIngestionQueue;
  /** Same pattern as `incidentIngestionQueue`, for Phase 7's investigation queue — defaults
   *  to a synchronous inline stand-in that runs against packages/ai's MOCK_MODE client
   *  unless env carries a real ANTHROPIC_API_KEY and MOCK_MODE is off (see
   *  queue/inline-investigation-queue.ts). */
  incidentInvestigationQueue?: IncidentInvestigationQueue;
  /** Same pattern again, for Phase 8's remediation queue (see queue/inline-remediation-queue.ts). */
  incidentRemediationQueue?: IncidentRemediationQueue;
}

export function buildApp({
  db,
  env,
  secretProvider,
  incidentIngestionQueue,
  incidentInvestigationQueue,
  incidentRemediationQueue,
}: BuildAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const resolvedSecretProvider =
    secretProvider ??
    createSecretProvider(env.SECRET_PROVIDER, { masterKey: env.ENCRYPTION_MASTER_KEY });
  const resolvedRemediationQueue =
    incidentRemediationQueue ??
    createInlineRemediationQueue(db, {
      mockMode: env.MOCK_MODE,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      anthropicModel: env.ANTHROPIC_MODEL,
      secretProvider: resolvedSecretProvider,
    });
  // Not auto-chained into one another below — in production each hop is a genuinely
  // decoupled async queue message (worker.ts's real `queue` consumer chains
  // ingestion → investigation → remediation off the HTTP request entirely), and collapsing
  // that into synchronous calls here would just be this inline test/dev stand-in inventing
  // tighter coupling than production has. Callers that want the full chain inline (tests
  // that exercise Phase 7/8 end to end) pass already-chained queues explicitly — see
  // test-helpers.ts's `chainInvestigation`/`chainRemediation` options.
  const resolvedInvestigationQueue =
    incidentInvestigationQueue ??
    createInlineInvestigationQueue(db, {
      mockMode: env.MOCK_MODE,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      anthropicModel: env.ANTHROPIC_MODEL,
      secretProvider: resolvedSecretProvider,
    });
  const resolvedQueue = incidentIngestionQueue ?? createInlineIngestionQueue(db);
  const organizationRepository = new OrganizationRepository(db);

  // Request IDs threaded through logs and returned to the client — ARCHITECTURE.md §11.
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
    c.header("x-request-id", c.get("requestId"));
  });

  app.use("*", cors({ origin: env.CORS_ORIGIN, credentials: true }));

  // Rate-limit per-IP by default; per-org limiting for authenticated, high-volume routes
  // (webhooks, incident ingestion) is added alongside those routes in later phases rather
  // than globally here. See middleware/rate-limit.ts for the per-isolate caveat on Workers.
  app.use("*", rateLimit({ max: 100, windowMs: 60_000 }));

  app.onError(handleError);

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.route("/api/auth", buildAuthRoutes({ db, env }));
  app.route("/api/organizations", buildOrganizationRoutes({ db, env }));
  app.route(
    "/api/credentials",
    buildCredentialRoutes({ db, env, secretProvider: resolvedSecretProvider, organizationRepository }),
  );
  app.route(
    "/api/map-servers",
    buildMapServerRoutes({ db, env, secretProvider: resolvedSecretProvider, organizationRepository }),
  );
  app.route(
    "/api/integrations",
    buildIntegrationRoutes({ db, env, secretProvider: resolvedSecretProvider, organizationRepository }),
  );
  app.route(
    "/api/incidents",
    buildIncidentRoutes({
      db,
      env,
      organizationRepository,
      investigationQueue: resolvedInvestigationQueue,
      remediationQueue: resolvedRemediationQueue,
      secretProvider: resolvedSecretProvider,
    }),
  );
  app.route(
    "/api/automation-policies",
    buildAutomationPolicyRoutes({ db, env, organizationRepository }),
  );
  app.route("/api/audit-logs", buildAuditLogRoutes({ db, env, organizationRepository }));
  app.route("/api/metrics", buildMetricsRoutes({ db, env, organizationRepository }));
  app.route("/api/webhooks", buildWebhookRoutes({ db, env, queue: resolvedQueue }));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Not found", requestId: c.get("requestId") } }, 404),
  );

  return app;
}
