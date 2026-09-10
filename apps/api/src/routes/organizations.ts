import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { OrganizationRepository, UserRepository, auditLogWriter, slugify } from "@resolution/database";
import { hashPassword, writeAuditLog } from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateOrganizationBody = z.object({
  name: z.string().min(1).max(200),
});

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

const AddMemberBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).default("MEMBER"),
});

const UpdateMemberRoleBody = z.object({
  role: z.enum(ROLES),
});

/** A random, strong temporary password for an admin-created local user — shown to the
 *  inviting admin exactly once in the response (same masking discipline as credentials);
 *  the new user is expected to change it on first login. No email delivery is wired up
 *  yet (Phase 3 doesn't add an email provider), so relaying it is on the admin for now. */
function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
    let temporaryPassword: string | undefined;

    if (user) {
      if (await organizations.findMembership(user.id, organizationId)) {
        throw new ConflictError("This user is already a member of the organization");
      }
    } else {
      temporaryPassword = generateTemporaryPassword();
      user = await users.create({
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(temporaryPassword),
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
      metadata: { email: user.email, role: body.role, newAccount: Boolean(temporaryPassword) },
    });

    return c.json(
      {
        member: { userId: user.id, email: user.email, name: user.name, role: body.role },
        // Present only when a brand-new account was created for this email — never
        // returned again after this response, same discipline as a credential's secret.
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

  return router;
}
