import type { Organization, OrganizationMember, PrismaClient, Role } from "@prisma/client";

export interface OrganizationWithRole extends Organization {
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
   *  without at least one owner. */
  async createWithOwner(input: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<Organization> {
    return this.db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.name, slug: input.slug },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: input.ownerUserId,
          role: "OWNER",
        },
      });
      return organization;
    });
  }

  async listForUser(userId: string): Promise<OrganizationWithRole[]> {
    const memberships = await this.db.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({ ...m.organization, role: m.role }));
  }

  /** The single point where "is this user a member of this org, and what's their role"
   *  gets answered — apps/api's tenant-context middleware calls this on every
   *  org-scoped request instead of trusting anything from the client. Returns null if
   *  the user has no membership (including if the org doesn't exist), which the caller
   *  treats as a 404, not a 403 — never confirm an org's existence to a non-member. */
  findMembership(userId: string, organizationId: string): Promise<OrganizationMember | null> {
    return this.db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
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
