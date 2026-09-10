import type { Organization, OrganizationMember, PrismaClient } from "@prisma/client";
import type { Role } from "@resolution/security";

export interface OrganizationWithRole extends Organization {
  role: Role;
}

/** D1/SQLite has no native enum type — `role` is a plain String column at the database
 *  level (see schema.prisma). This is the typed shape repository callers actually see. */
export interface Membership extends Omit<OrganizationMember, "role"> {
  role: Role;
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
