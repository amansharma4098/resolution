import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository, auditLogWriter, slugify } from "@resolution/database";
import { writeAuditLog } from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { NotFoundError } from "../lib/errors";

const CreateOrganizationBody = z.object({
  name: z.string().min(1).max(200),
});

export function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: { db: PrismaClient; env: Env },
): void {
  const { db, env } = deps;
  const organizations = new OrganizationRepository(db);
  const auth = authenticate(env.JWT_SECRET);

  app.post("/", { preHandler: auth }, async (request, reply) => {
    const body = CreateOrganizationBody.parse(request.body);

    const baseSlug = slugify(body.name);
    let slug = baseSlug;
    let suffix = 1;
    while (await organizations.slugExists(slug)) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const organization = await organizations.createWithOwner({
      name: body.name,
      slug,
      ownerUserId: request.userId!,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: organization.id,
      actorType: "user",
      actorId: request.userId,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
      requestId: request.id,
      metadata: { name: organization.name, slug: organization.slug },
    });

    reply.status(201).send({ organization: { ...organization, role: "OWNER" } });
  });

  app.get("/", { preHandler: auth }, async (request, reply) => {
    const list = await organizations.listForUser(request.userId!);
    reply.send({ organizations: list });
  });

  // Unlike every other org-scoped route (which reads the X-Organization-Id header via
  // resolveTenantContext, see middleware/tenant-context.ts), this one identifies the org
  // by its URL param — that's fine here specifically because the param *is* the resource
  // being fetched, not ambient context for some other resource. Membership is still
  // re-checked against the database on every call, never assumed from the URL.
  app.get<{ Params: { id: string } }>("/:id", { preHandler: auth }, async (request, reply) => {
    const membership = await organizations.findMembership(request.userId!, request.params.id);
    if (!membership) throw new NotFoundError("Organization not found");

    const organization = await organizations.findById(request.params.id);
    if (!organization) throw new NotFoundError("Organization not found");

    reply.send({ organization: { ...organization, role: membership.role } });
  });
}
