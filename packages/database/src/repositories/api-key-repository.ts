import type { ApiKey, PrismaClient } from "@prisma/client";

/** Same identity-not-tenant-owned treatment as UserRepository/PasswordResetTokenRepository —
 *  an API key belongs to a user, not an organization; which organizations it can act on
 *  behalf of is checked per-call (see apps/api/src/routes/mcp.ts), same as a browser
 *  session. */
export class ApiKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  create(input: { userId: string; name: string; keyHash: string }): Promise<ApiKey> {
    return this.db.apiKey.create({ data: input });
  }

  /** A key is valid only if it hasn't been revoked — defined once here, mirroring
   *  PasswordResetTokenRepository.findValidByHash's "one definition of valid" reasoning. */
  findValidByHash(keyHash: string): Promise<ApiKey | null> {
    return this.db.apiKey.findFirst({ where: { keyHash, revokedAt: null } });
  }

  touchLastUsed(id: string): Promise<ApiKey> {
    return this.db.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }

  listByUser(userId: string): Promise<ApiKey[]> {
    return this.db.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  /** Scoped to `userId` in the query itself (not just checked after) — a revoke request for
   *  a key id that exists but belongs to someone else finds nothing, same tenant-isolation
   *  discipline as every org-scoped repository's `scope()`, just for user-owned rows. */
  async revoke(id: string, userId: string): Promise<ApiKey | null> {
    const existing = await this.db.apiKey.findFirst({ where: { id, userId } });
    if (!existing) return null;
    return this.db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
