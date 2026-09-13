import type { PrismaClient, PasswordResetToken } from "@prisma/client";

/**
 * Same identity-not-tenant-owned treatment as UserRepository — a reset token belongs to a
 * user, not an organization, and is only ever reachable from apps/api's auth routes before
 * any tenant context exists.
 */
export class PasswordResetTokenRepository {
  constructor(private readonly db: PrismaClient) {}

  create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<PasswordResetToken> {
    return this.db.passwordResetToken.create({ data: input });
  }

  /** A token is valid only if it hasn't been used and hasn't expired — defined once here so
   *  every call site shares the same definition of "valid," rather than each one filtering
   *  usedAt/expiresAt itself. */
  findValidByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.db.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  markUsed(id: string): Promise<PasswordResetToken> {
    return this.db.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  }
}
