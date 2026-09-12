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

  create(input: {
    email: string;
    name?: string;
    passwordHash: string;
    // True when someone other than the user themself set this initial password (an admin
    // typed one in, or the system generated one) — self-serve signup leaves this false.
    mustChangePassword?: boolean;
  }): Promise<User> {
    return this.db.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword ?? false,
      },
    });
  }

  /** Sets a new password and clears mustChangePassword — the only way that flag comes back
   *  off. Used by POST /api/auth/change-password. */
  updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
  }
}
