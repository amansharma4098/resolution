import type { PrismaClient, User } from "@prisma/client";

/**
 * User is identity, not a tenant-owned resource — it isn't scoped by organizationId (a
 * user can belong to many organizations), so this does not extend TenantScopedRepository.
 * Every method here is reachable only from apps/api's auth routes, before any tenant
 * context exists.
 */
export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  create(input: { email: string; name?: string; passwordHash: string }): Promise<User> {
    return this.db.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
      },
    });
  }
}
