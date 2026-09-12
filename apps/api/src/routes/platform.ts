import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository, UserRepository, auditLogWriter, slugify } from "@resolution/database";
import { generateTemporaryPassword, hashPassword, writeAuditLog } from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireSuperAdmin } from "../middleware/require-super-admin";
import type { AppEnv } from "../types";

const CreateTenantBody = z.object({
  organizationName: z.string().min(1).max(200),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).optional(),
  // Optional — the Super Admin can set the new tenant admin's initial password directly
  // instead of relying on a generated one. Either way the account is created with
  // mustChangePassword set.
  adminPassword: z.string().min(12).optional(),
});

/**
 * The Super Admin surface — platform-level, not tenant-scoped (see
 * middleware/require-super-admin.ts's header comment on why this is a separate concept from
 * OrganizationMember.role). This is additive to, not a replacement for, self-serve
 * organization creation (`POST /api/organizations`, unchanged) — the product supports both
 * a self-serve motion (someone signs up and creates their own org) and a sales-assisted one
 * (the platform owner provisions a tenant and its admin directly, the way an enterprise
 * customer is typically onboarded). See IMPLEMENTATION_PLAN.md's tenant-management entry.
 */
export function buildPlatformRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db, env } = deps;
  const router = new Hono<AppEnv>();
  const organizations = new OrganizationRepository(db);
  const users = new UserRepository(db);
  const auth = authenticate(env.JWT_SECRET);
  const superAdmin = requireSuperAdmin(db);

  router.get("/tenants", auth, superAdmin, async (c) => {
    const tenants = await organizations.listAll();
    return c.json({ tenants });
  });

  router.post("/tenants", auth, superAdmin, async (c) => {
    const body = CreateTenantBody.parse(await c.req.json());

    const baseSlug = slugify(body.organizationName);
    let slug = baseSlug;
    let suffix = 1;
    while (await organizations.slugExists(slug)) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    let adminUser = await users.findByEmail(body.adminEmail);
    // Only returned to the caller when *we* generated it (body.adminPassword absent) — if
    // the Super Admin typed their own password in, they already know it.
    let temporaryPassword: string | undefined;
    let newAccount = false;

    if (adminUser) {
      // An existing account being handed a brand-new tenant as its OWNER is a real,
      // supported case (e.g. re-onboarding someone who already has a login elsewhere on
      // the platform) — just not a new-account case, so no temp password to show.
    } else {
      newAccount = true;
      const initialPassword = body.adminPassword ?? generateTemporaryPassword();
      if (!body.adminPassword) temporaryPassword = initialPassword;
      adminUser = await users.create({
        email: body.adminEmail,
        name: body.adminName,
        passwordHash: await hashPassword(initialPassword),
        mustChangePassword: true,
      });
    }

    const organization = await organizations.createWithOwner({
      name: body.organizationName,
      slug,
      ownerUserId: adminUser.id,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: organization.id,
      actorType: "user",
      actorId: c.get("userId"),
      action: "platform.tenant_created",
      targetType: "Organization",
      targetId: organization.id,
      requestId: c.get("requestId"),
      metadata: {
        name: organization.name,
        slug: organization.slug,
        adminEmail: adminUser.email,
        newAccount,
      },
    });

    return c.json(
      {
        organization,
        admin: { userId: adminUser.id, email: adminUser.email, name: adminUser.name },
        newAccount,
        // Present only when a brand-new account was created *and* we generated its
        // password — never returned again after this response, same discipline as a
        // credential's secret or a member invite's.
        temporaryPassword,
      },
      201,
    );
  });

  return router;
}
