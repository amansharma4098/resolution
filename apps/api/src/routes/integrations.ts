import { Hono } from "hono";
import { z } from "zod";
import { IncidentSourceType } from "@resolution/shared";
import type { Integration, PrismaClient } from "@resolution/database";
import { CredentialRepository, IntegrationRepository, auditLogWriter } from "@resolution/database";
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

function toPublicIntegration(integration: Integration) {
  return integration;
}

/**
 * Generic CRUD for incident-source configuration records. The real OAuth/webhook wiring
 * for Jira and ServiceNow lands in Phases 3–4 (IMPLEMENTATION_PLAN.md) — this is the
 * provider-agnostic config layer underneath that, same pattern as Map Servers.
 */
export function buildIntegrationRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
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

    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const integration = await integrations.create(body);

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

    return c.json({ integration: toPublicIntegration(integration) }, 201);
  });

  router.get("/", auth, tenantContext, async (c) => {
    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const list = await integrations.list();
    return c.json({ integrations: list.map(toPublicIntegration) });
  });

  router.get("/:id", auth, tenantContext, async (c) => {
    const integrations = new IntegrationRepository(db, c.get("organizationId")!);
    const integration = await integrations.findById(c.req.param("id"));
    if (!integration) throw new NotFoundError("Integration not found");
    return c.json({ integration: toPublicIntegration(integration) });
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

  return router;
}
