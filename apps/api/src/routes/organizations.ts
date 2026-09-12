import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository, UserRepository, auditLogWriter, slugify } from "@resolution/database";
import { generateTemporaryPassword, hashPassword, requireRole, writeAuditLog } from "@resolution/security";
import { ResolutionMode } from "@resolution/shared";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateOrganizationBody = z.object({
  name: z.string().min(1).max(200),
});

const UpdateOrganizationBody = z.object({
  resolutionMode: ResolutionMode,
});

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

const AddMemberBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).default("MEMBER"),
  // Optional — an ADMIN/OWNER can set this teammate's initial password directly instead of
  // relying on a generated one. Either way the account is created with mustChangePassword
  // set, so the choice here only affects who has to relay the password, not the
  // first-login-change requirement.
  password: z.string().min(12).optional(),
});

const UpdateMemberRoleBody = z.object({
  role: z.enum(ROLES),
});

export function buildOrganizationRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db, env } = deps;
  const router = new Hono<AppEnv>();
  const organizations = new OrganizationRepository(db);
  const users = new UserRepository(db);
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizations);
  const requireAdmin = requireMinimumRole("ADMIN");

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

  // ── Team / member management — the tenant model enterprise sales actually needs: an
  // org's OWNER/ADMIN brings teammates into their own tenant. There is no self-serve path
  // for a user to join someone else's org — every membership is either the org creator
  // (OWNER, from createWithOwner above) or explicitly added here by an existing ADMIN+.
  //
  // Registered ahead of "/:id" below — otherwise Hono would match "/members" against the
  // param route first (id="members") instead of these static routes. Same fix as
  // map-servers' "/catalog" vs "/:id" (see routes/map-servers.ts). ──

  router.get("/members", auth, tenantContext, async (c) => {
    const members = await organizations.listMembers(c.get("organizationId")!);
    return c.json({ members });
  });

  router.post("/members", auth, tenantContext, requireAdmin, async (c) => {
    const body = AddMemberBody.parse(await c.req.json());
    const organizationId = c.get("organizationId")!;

    let user = await users.findByEmail(body.email);
    // Only returned to the caller when *we* generated it (body.password absent) — if the
    // admin typed their own password in, they already know it, so there's nothing new to
    // show them.
    let temporaryPassword: string | undefined;
    let newAccount = false;

    if (user) {
      if (await organizations.findMembership(user.id, organizationId)) {
        throw new ConflictError("This user is already a member of the organization");
      }
    } else {
      newAccount = true;
      const initialPassword = body.password ?? generateTemporaryPassword();
      if (!body.password) temporaryPassword = initialPassword;
      user = await users.create({
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(initialPassword),
        mustChangePassword: true,
      });
    }

    await organizations.addMember(organizationId, user.id, body.role);

    await writeAuditLog(auditLogWriter(db), {
      organizationId,
      actorType: "user",
      actorId: c.get("userId"),
      action: "organization.member_added",
      targetType: "User",
      targetId: user.id,
      requestId: c.get("requestId"),
      metadata: { email: user.email, role: body.role, newAccount },
    });

    return c.json(
      {
        member: { userId: user.id, email: user.email, name: user.name, role: body.role },
        newAccount,
        // Present only when a brand-new account was created *and* we generated its
        // password — never returned again after this response, same discipline as a
        // credential's secret.
        temporaryPassword,
      },
      201,
    );
  });

  router.patch("/members/:userId", auth, tenantContext, requireAdmin, async (c) => {
    const organizationId = c.get("organizationId")!;
    const targetUserId = c.req.param("userId");
    const body = UpdateMemberRoleBody.parse(await c.req.json());

    const existing = await organizations.findMembership(targetUserId, organizationId);
    if (!existing) throw new NotFoundError("Member not found");

    if (existing.role === "OWNER" && body.role !== "OWNER" && (await organizations.countOwners(organizationId)) <= 1) {
      throw new ValidationError("An organization must always have at least one OWNER");
    }

    const updated = await organizations.updateMemberRole(organizationId, targetUserId, body.role);

    await writeAuditLog(auditLogWriter(db), {
      organizationId,
      actorType: "user",
      actorId: c.get("userId"),
      action: "organization.member_role_changed",
      targetType: "User",
      targetId: targetUserId,
      requestId: c.get("requestId"),
      metadata: { from: existing.role, to: body.role },
    });

    return c.json({ member: updated });
  });

  router.delete("/members/:userId", auth, tenantContext, requireAdmin, async (c) => {
    const organizationId = c.get("organizationId")!;
    const targetUserId = c.req.param("userId");

    const existing = await organizations.findMembership(targetUserId, organizationId);
    if (!existing) throw new NotFoundError("Member not found");

    if (existing.role === "OWNER" && (await organizations.countOwners(organizationId)) <= 1) {
      throw new ValidationError("An organization must always have at least one OWNER — transfer ownership first");
    }

    await organizations.removeMember(organizationId, targetUserId);

    await writeAuditLog(auditLogWriter(db), {
      organizationId,
      actorType: "user",
      actorId: c.get("userId"),
      action: "organization.member_removed",
      targetType: "User",
      targetId: targetUserId,
      requestId: c.get("requestId"),
    });

    return c.body(null, 204);
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

  // Same URL-param-identifies-resource pattern as GET /:id above (see its comment) — an
  // admin-only manual check against the resolved membership, not the tenantContext/
  // requireMinimumRole middleware pair (which read the X-Organization-Id header, not the
  // URL param). Phase 8: the only field this currently updates is `resolutionMode`
  // (ARCHITECTURE.md §7) — the org-level dial the policy engine reads.
  router.patch("/:id", auth, async (c) => {
    const id = c.req.param("id");
    const membership = await organizations.findMembership(c.get("userId")!, id);
    if (!membership) throw new NotFoundError("Organization not found");
    requireRole(membership.role, "ADMIN");

    const body = UpdateOrganizationBody.parse(await c.req.json());
    const updated = await organizations.updateResolutionMode(id, body.resolutionMode);

    await writeAuditLog(auditLogWriter(db), {
      organizationId: id,
      actorType: "user",
      actorId: c.get("userId"),
      action: "organization.resolution_mode_changed",
      targetType: "Organization",
      targetId: id,
      requestId: c.get("requestId"),
      metadata: { resolutionMode: body.resolutionMode },
    });

    return c.json({ organization: { ...updated, role: membership.role } });
  });

  return router;
}
