import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository, auditLogWriter, slugify } from "@resolution/database";
import { writeAuditLog } from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateOrganizationBody = z.object({
  name: z.string().min(1).max(200),
});

export function buildOrganizationRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db, env } = deps;
  const router = new Hono<AppEnv>();
  const organizations = new OrganizationRepository(db);
  const auth = authenticate(env.JWT_SECRET);

  router.post("/", auth, async (c) => {
    const body = CreateOrganizationBody.parse(await c.req.json());

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
      ownerUserId: c.get("userId")!,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: organization.id,
      actorType: "user",
      actorId: c.get("userId"),
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
      requestId: c.get("requestId"),
      metadata: { name: organization.name, slug: organization.slug },
    });

    return c.json({ organization: { ...organization, role: "OWNER" } }, 201);
  });

  router.get("/", auth, async (c) => {
    const list = await organizations.listForUser(c.get("userId")!);
    return c.json({ organizations: list });
  });

  // Unlike every other org-scoped route (which reads the X-Organization-Id header via
  // resolveTenantContext, see middleware/tenant-context.ts), this one identifies the org
  // by its URL param — that's fine here specifically because the param *is* the resource
  // being fetched, not ambient context for some other resource. Membership is still
  // re-checked against the database on every call, never assumed from the URL.
  router.get("/:id", auth, async (c) => {
    const id = c.req.param("id");
    const membership = await organizations.findMembership(c.get("userId")!, id);
    if (!membership) throw new NotFoundError("Organization not found");

    const organization = await organizations.findById(id);
    if (!organization) throw new NotFoundError("Organization not found");

    return c.json({ organization: { ...organization, role: membership.role } });
  });

  return router;
}
