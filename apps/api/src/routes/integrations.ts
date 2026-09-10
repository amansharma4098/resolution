import type { FastifyInstance } from "fastify";
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
export function registerIntegrationRoutes(
  app: FastifyInstance,
  deps: { db: PrismaClient; env: Env; organizationRepository: OrganizationRepository },
): void {
  const { db, env, organizationRepository } = deps;
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");
  const preHandler = [auth, tenantContext];

  app.post("/", { preHandler: [...preHandler, requireAdmin] }, async (request, reply) => {
    const body = CreateIntegrationBody.parse(request.body);

    if (body.credentialId) {
      const credentials = new CredentialRepository(db, request.organizationId!);
      if (!(await credentials.findById(body.credentialId))) {
        throw new ValidationError("credentialId does not reference a credential in this organization");
      }
    }

    const integrations = new IntegrationRepository(db, request.organizationId!);
    const integration = await integrations.create(body);

    await writeAuditLog(auditLogWriter(db), {
      organizationId: request.organizationId,
      actorType: "user",
      actorId: request.userId,
      action: "integration.created",
      targetType: "Integration",
      targetId: integration.id,
      requestId: request.id,
      metadata: { type: integration.type, name: integration.name },
    });

    reply.status(201).send({ integration: toPublicIntegration(integration) });
  });

  app.get("/", { preHandler }, async (request, reply) => {
    const integrations = new IntegrationRepository(db, request.organizationId!);
    const list = await integrations.list();
    reply.send({ integrations: list.map(toPublicIntegration) });
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler }, async (request, reply) => {
    const integrations = new IntegrationRepository(db, request.organizationId!);
    const integration = await integrations.findById(request.params.id);
    if (!integration) throw new NotFoundError("Integration not found");
    reply.send({ integration: toPublicIntegration(integration) });
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [...preHandler, requireAdmin] },
    async (request, reply) => {
      const integrations = new IntegrationRepository(db, request.organizationId!);
      const deleted = await integrations.delete(request.params.id);
      if (!deleted) throw new NotFoundError("Integration not found");

      await writeAuditLog(auditLogWriter(db), {
        organizationId: request.organizationId,
        actorType: "user",
        actorId: request.userId,
        action: "integration.deleted",
        targetType: "Integration",
        targetId: request.params.id,
        requestId: request.id,
      });

      reply.status(204).send();
    },
  );
}
