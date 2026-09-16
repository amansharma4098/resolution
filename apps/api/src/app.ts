import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository } from "@resolution/database";
import { createSecretProvider, type SecretProvider } from "@resolution/credentials";
import type { Env } from "./env";
import type { AppEnv } from "./types";
import { createEmailSender, type EmailSender } from "@resolution/email";
import { createAnthropicLlmClient, createMockChatClient, createLlmClient, type LlmClient } from "@resolution/ai";
import { handleError } from "./plugins/error-handler";
import { createRateLimitStore, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { buildAuthRoutes } from "./routes/auth";
import { buildApiKeyRoutes } from "./routes/api-keys";
import { buildMcpRoutes } from "./routes/mcp";
import { buildChatRoutes } from "./routes/chat";
import { buildOrganizationRoutes } from "./routes/organizations";
import { buildCredentialRoutes } from "./routes/credentials";
import { buildMapServerRoutes } from "./routes/map-servers";
import { buildIntegrationRoutes } from "./routes/integrations";
import { buildIncidentRoutes } from "./routes/incidents";
import { buildAutomationPolicyRoutes } from "./routes/automation-policies";
import { buildAuditLogRoutes } from "./routes/audit-logs";
import { buildMetricsRoutes } from "./routes/metrics";
import { buildPlatformRoutes } from "./routes/platform";
import { buildBillingRoutes } from "./routes/billing";
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
  /** Injectable for tests (a fake that captures sent messages) — defaults to the real
   *  Resend-or-console sender selected by env.RESEND_API_KEY/EMAIL_FROM (see
   *  packages/email/src/sender.ts's createEmailSender). */
  emailSender?: EmailSender;
  /** Sliding-window hit logs for rate limiting, keyed by which routes share a budget —
   *  see middleware/rate-limit.ts's header comment for why these must be passed in rather
   *  than created inside buildApp. Each defaults to its own fresh, empty store when
   *  omitted, which is what every test and local-dev buildApp call wants: isolation between
   *  runs. worker.ts is the one caller that passes real stores, hoisted to module scope so
   *  they persist across the requests one Worker isolate serves. */
  rateLimitStores?: {
    global: RateLimitStore;
    login: RateLimitStore;
    signup: RateLimitStore;
    forgotPassword: RateLimitStore;
  };
  /** Injectable for tests (a scripted fake) — defaults to a real Anthropic client when
   *  env carries a key and MOCK_MODE is off, else a chat-specific mock (packages/ai's
   *  createMockChatClient — deliberately not the investigation agent's mock-client.ts,
   *  which is shaped around a different tool-calling loop; see that file's header
   *  comment). Powers routes/chat.ts's in-app assistant only — the investigation/
   *  remediation agents build their own LlmClient independently (queue/inline-*-queue.ts). */
  chatLlmClient?: LlmClient;
}

export function buildApp({
  db,
  env,
  secretProvider,
  incidentIngestionQueue,
  incidentInvestigationQueue,
  incidentRemediationQueue,
  emailSender,
  rateLimitStores,
  chatLlmClient,
}: BuildAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const resolvedEmailSender =
    emailSender ?? createEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  const resolvedRateLimitStores = {
    global: rateLimitStores?.global ?? createRateLimitStore(),
    login: rateLimitStores?.login ?? createRateLimitStore(),
    signup: rateLimitStores?.signup ?? createRateLimitStore(),
    forgotPassword: rateLimitStores?.forgotPassword ?? createRateLimitStore(),
  };
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
  app.use("*", rateLimit(resolvedRateLimitStores.global, { max: 100, windowMs: 60_000 }));

  app.onError(handleError);

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.route(
    "/api/auth",
    buildAuthRoutes({
      db,
      env,
      emailSender: resolvedEmailSender,
      rateLimitStores: resolvedRateLimitStores,
    }),
  );
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
  app.route("/api/platform", buildPlatformRoutes({ db, env }));
  app.route("/api/billing", buildBillingRoutes({ db, env, organizationRepository }));
  app.route("/api/webhooks", buildWebhookRoutes({ db, env, queue: resolvedQueue }));
  app.route("/api/api-keys", buildApiKeyRoutes({ db, env }));
  app.route(
    "/api/mcp",
    buildMcpRoutes({
      db,
      env,
      organizationRepository,
      investigationQueue: resolvedInvestigationQueue,
      remediationQueue: resolvedRemediationQueue,
      secretProvider: resolvedSecretProvider,
      // Only used for get_postmortem/generate_postmortem/decide_approval's postmortem draft —
      // the general-purpose factory (mock-if-unconfigured), not the chat-specific client
      // below, since there's no conversational judgment involved here.
      llmClient: createLlmClient({ mockMode: env.MOCK_MODE, apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }),
    }),
  );
  app.route(
    "/api/chat",
    buildChatRoutes({
      db,
      env,
      organizationRepository,
      investigationQueue: resolvedInvestigationQueue,
      remediationQueue: resolvedRemediationQueue,
      secretProvider: resolvedSecretProvider,
      llmClient:
        chatLlmClient ??
        (env.MOCK_MODE || !env.ANTHROPIC_API_KEY
          ? createMockChatClient()
          : createAnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL })),
    }),
  );

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Not found", requestId: c.get("requestId") } }, 404),
  );

  return app;
}
