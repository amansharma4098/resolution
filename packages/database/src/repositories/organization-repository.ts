import type { Organization, OrganizationMember, PrismaClient } from "@prisma/client";
import type { Role } from "@resolution/security";
import type { ResolutionMode } from "@resolution/shared";

export interface OrganizationWithRole extends Organization {
  role: Role;
}

/** D1/SQLite has no native enum type — `role` is a plain String column at the database
 *  level (see schema.prisma). This is the typed shape repository callers actually see. */
export interface Membership extends Omit<OrganizationMember, "role"> {
  role: Role;
}

export interface MemberWithUser extends Membership {
  email: string;
  name: string | null;
}

/**
 * Organization is the tenant root, not a tenant-owned resource — so, like UserRepository,
 * this doesn't extend TenantScopedRepository. Every method takes the caller's userId (from
 * the session) and derives what they're allowed to see from OrganizationMember, never from
 * a client-supplied organizationId.
 */
export class OrganizationRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Creates the organization and its OWNER membership atomically — an org can never exist
   *  without at least one owner.
   *
   *  Uses Prisma's *batch* `$transaction([...])` form, not the interactive callback form
   *  (`$transaction(async (tx) => ...)`) — D1 doesn't support interactive transactions
   *  ("Cloudflare D1 does not support interactive transactions", confirmed against the
   *  real deployed Worker). The batch form needs the organization's id up front so the
   *  membership row can reference it without reading the create result first; Prisma's
   *  `@default(uuid())` is generated client-side, so we just generate it ourselves here
   *  instead of letting Prisma do it implicitly. */
  async createWithOwner(input: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<Organization> {
    const organizationId = crypto.randomUUID();
    const [organization] = await this.db.$transaction([
      this.db.organization.create({
        data: { id: organizationId, name: input.name, slug: input.slug },
      }),
      this.db.organizationMember.create({
        data: { organizationId, userId: input.ownerUserId, role: "OWNER" },
      }),
    ]);
    return organization;
  }

  async listForUser(userId: string): Promise<OrganizationWithRole[]> {
    const memberships = await this.db.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({ ...m.organization, role: m.role as Role }));
  }

  /** The single point where "is this user a member of this org, and what's their role"
   *  gets answered — apps/api's tenant-context middleware calls this on every
   *  org-scoped request instead of trusting anything from the client. Returns null if
   *  the user has no membership (including if the org doesn't exist), which the caller
   *  treats as a 404, not a 403 — never confirm an org's existence to a non-member. */
  async findMembership(userId: string, organizationId: string): Promise<Membership | null> {
    const membership = await this.db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return membership ? { ...membership, role: membership.role as Role } : null;
  }

  findById(organizationId: string): Promise<Organization | null> {
    return this.db.organization.findUnique({ where: { id: organizationId } });
  }

  async slugExists(slug: string): Promise<boolean> {
    const existing = await this.db.organization.findUnique({ where: { slug } });
    return existing !== null;
  }

  /** The org's full member roster — for the Settings/Team screen. Every enterprise
   *  customer needs this: an OWNER/ADMIN brings teammates into their own tenant, never the
   *  other way around (no cross-tenant self-signup into someone else's org). */
  async listMembers(organizationId: string): Promise<MemberWithUser[]> {
    const members = await this.db.organizationMember.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role as Role,
      createdAt: m.createdAt,
      email: m.user.email,
      name: m.user.name,
    }));
  }

  async countOwners(organizationId: string): Promise<number> {
    return this.db.organizationMember.count({ where: { organizationId, role: "OWNER" } });
  }

  addMember(organizationId: string, userId: string, role: Role): Promise<OrganizationMember> {
    return this.db.organizationMember.create({ data: { organizationId, userId, role } });
  }

  /** Returns false (never throws) if the membership doesn't exist — callers turn that into
   *  a 404. Callers are responsible for the "don't remove the last OWNER" check
   *  (countOwners) before calling this; it's a business rule, not a data-layer concern. */
  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const existing = await this.findMembership(userId, organizationId);
    if (!existing) return false;
    await this.db.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return true;
  }

  async updateMemberRole(organizationId: string, userId: string, role: Role): Promise<Membership | null> {
    const existing = await this.findMembership(userId, organizationId);
    if (!existing) return null;
    const updated = await this.db.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { role },
    });
    return { ...updated, role: updated.role as Role };
  }

  /** Phase 8: the org-level dial the policy engine reads (ARCHITECTURE.md §7) —
   *  OBSERVE_ONLY (default) never remediates automatically, AUTONOMOUS lets an
   *  AutomationPolicy's own AUTO behavior actually run unattended. */
  async updateResolutionMode(organizationId: string, resolutionMode: ResolutionMode): Promise<Organization> {
    return this.db.organization.update({ where: { id: organizationId }, data: { resolutionMode } });
  }
}

/** Turns "Acme Corp" into "acme-corp", then "acme-corp-2" etc. if taken — called by the
 *  create-organization route, which retries against slugExists() until it finds a free one. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}
