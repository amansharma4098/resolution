import type { AuthenticationType, Credential, CredentialStatus, PrismaClient } from "@prisma/client";
import { TenantScopedRepository } from "../tenant-scoped-repository";

export interface CreateCredentialInput {
  name: string;
  provider: string;
  authenticationType: AuthenticationType;
  encryptedData: string;
}

/**
 * Every method here filters by organizationId (via TenantScopedRepository.scope()) —
 * ARCHITECTURE.md §8. `findById` uses `findFirst` with the org filter baked into the
 * `where`, not `findUnique` by id alone, so a credential id from another org simply
 * doesn't match and returns null rather than ever being fetchable cross-tenant. The
 * mutating methods (update/delete) all re-check ownership first and return null instead of
 * throwing when the row isn't in this org — callers (apps/api routes) turn that into a 404,
 * the same as if the row didn't exist at all, never a 403 that would confirm it does.
 */
export class CredentialRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  create(input: CreateCredentialInput): Promise<Credential> {
    return this.db.credential.create({
      data: { ...input, organizationId: this.organizationId },
    });
  }

  list(): Promise<Credential[]> {
    return this.db.credential.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
  }

  findById(id: string): Promise<Credential | null> {
    return this.db.credential.findFirst({ where: { ...this.scope(), id } });
  }

  async updateEncryptedData(id: string, encryptedData: string): Promise<Credential | null> {
    if (!(await this.findById(id))) return null;
    return this.db.credential.update({
      where: { id },
      data: { encryptedData, status: "UNVERIFIED", lastValidatedAt: null },
    });
  }

  async updateStatus(id: string, status: CredentialStatus): Promise<Credential | null> {
    if (!(await this.findById(id))) return null;
    return this.db.credential.update({
      where: { id },
      data: { status, lastValidatedAt: new Date() },
    });
  }

  /** Returns whether a row was actually deleted (false if it wasn't in this org). */
  async delete(id: string): Promise<boolean> {
    if (!(await this.findById(id))) return false;
    await this.db.credential.delete({ where: { id } });
    return true;
  }
}
