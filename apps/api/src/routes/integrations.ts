import { Hono } from "hono";
import { z } from "zod";
import { IncidentSourceType } from "@resolution/shared";
import type { Integration, PrismaClient } from "@resolution/database";
import { CredentialRepository, IntegrationRepository, auditLogWriter } from "@resolution/database";
import { generateWebhookSecret, JiraApiError, JiraClient } from "@resolution/integrations";
import type { SecretProvider } from "@resolution/credentials";
import { writeAuditLog } from "@resolution/security";
import type { OrganizationRepository } from "@resolution/database";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateIntegrationBody = z.object({
  type: IncidentSourceType,
  name: z.string().min(1).max(200),
  credentialId: z.string().uuid().optional(),
  config: z.record(z.unknown()).default({}),
});

/** Every incident-source type that generates its own webhook secret at creation time — the
 *  customer configures their source system's outgoing webhook to send this as a header
 *  (X-Webhook-Secret). See packages/integrations/src/webhook-secret.ts. */
const WEBHOOK_BASED_SOURCES = new Set(["JIRA", "SERVICENOW"]);

/** GET/list responses never include the webhook secret in full — same masking discipline
 *  as a credential's secret. It's only ever returned once, in the create response. */
function maskConfig(integration: Integration): Integration {
  if (typeof integration.config.webhookSecret !== "string") return integration;
  const secret = integration.config.webhookSecret;
  return {
    ...integration,
    config: { ...integration.config, webhookSecret: `••••${secret.slice(-4)}` },
  };
}

/**
 * Generic CRUD for incident-source configuration records, plus real connectivity testing
 * for the sources that have a real adapter (JIRA today — see packages/integrations).
 * ServiceNow's real adapter lands in Phase 4; until then it behaves the same honest way
 * Map Servers do for an unregistered provider — DISCONNECTED with a clear reason, never a
 * fake CONNECTED.
 */
export function buildIntegrationRoutes(deps: {
  db: PrismaClient;
  env: Env;
  secretProvider: SecretProvider;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, secretProvider, organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");

  router.post("/", auth, tenantContext, requireAdmin, async (c) => {
    const body = CreateIntegrationBody.parse(await c.req.json());

    if (body.credentialId) {
      const credentials = new CredentialRepository(db, c.get("organizationId")!);
      if (!(await credentials.findById(body.credentialId))) {
        throw new ValidationError("credentialId does not reference a credential in this organization");
      }
    }

    const config = { ...body.config };
    if (WEBHOOK_BASED_SOURCES.has(body.type)) {
      // Always generated server-side — never trust a client-supplied "secret".
      config.webhookSecret = generateWebhookSecret();
    }

    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const integration = await integrations.create({ ...body, config });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "integration.created",
      targetType: "Integration",
      targetId: integration.id,
      requestId: c.get("requestId"),
      metadata: { type: integration.type, name: integration.name },
    });

    // Unmasked webhook secret and the exact URL to configure — shown exactly once, here.
    const webhookUrl = WEBHOOK_BASED_SOURCES.has(body.type)
      ? `${new URL(c.req.url).origin}/api/webhooks/${body.type.toLowerCase()}/${integration.id}`
      : undefined;

    return c.json({ integration, webhookUrl }, 201);
  });

  router.get("/", auth, tenantContext, async (c) => {
    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const list = await integrations.list();
    return c.json({ integrations: list.map(maskConfig) });
  });

  router.get("/:id", auth, tenantContext, async (c) => {
    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const integration = await integrations.findById(c.req.param("id"));
    if (!integration) throw new NotFoundError("Integration not found");
    return c.json({ integration: maskConfig(integration) });
  });

  router.delete("/:id", auth, tenantContext, requireAdmin, async (c) => {
    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const deleted = await integrations.delete(c.req.param("id"));
    if (!deleted) throw new NotFoundError("Integration not found");

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "integration.deleted",
      targetType: "Integration",
      targetId: c.req.param("id"),
      requestId: c.get("requestId"),
    });

    return c.body(null, 204);
  });

  // Real connectivity test for JIRA (calls the actual Jira REST API with the attached
  // credential); an honest DISCONNECTED-with-reason for every source that doesn't have a
  // real adapter yet — never a fake success.
  router.post("/:id/test", auth, tenantContext, requireAdmin, async (c) => {
    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const integration = await integrations.findById(c.req.param("id"));
    if (!integration) throw new NotFoundError("Integration not found");

    let status: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";
    let detail: string;

    if (integration.type !== "JIRA") {
      detail = `No real adapter for ${integration.type} yet in this deployment`;
    } else if (!integration.credentialId) {
      detail = "No credential attached to this integration";
    } else if (typeof integration.config.baseUrl !== "string" || !integration.config.baseUrl) {
      detail = "Missing config.baseUrl (your Jira Cloud site URL)";
    } else {
      const credentials = new CredentialRepository(db, c.get("organizationId")!);
      const credential = await credentials.findById(integration.credentialId);
      if (!credential) {
        detail = "Attached credential no longer exists";
      } else {
        try {
          const decrypted = await secretProvider.decrypt(credential.encryptedData, {
            organizationId: c.get("organizationId")!,
          });
          const client = new JiraClient(integration.config.baseUrl, {
            email: String(decrypted.username ?? decrypted.email ?? ""),
            apiToken: String(decrypted.password ?? decrypted.apiToken ?? ""),
          });
          const me = await client.getMyself();
          status = "CONNECTED";
          detail = `Authenticated as ${me.displayName}`;
        } catch (err) {
          detail =
            err instanceof JiraApiError
              ? `Jira returned ${err.status}: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Connection failed";
        }
      }
    }

    const updated = await integrations.updateStatus(integration.id, status);

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "integration.tested",
      targetType: "Integration",
      targetId: integration.id,
      requestId: c.get("requestId"),
      metadata: { status },
    });

    return c.json({ integration: maskConfig(updated!), detail });
  });

  return router;
}
