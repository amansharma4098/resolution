import type { PrismaClient } from "@prisma/client";
import type { AuthenticationType } from "@resolution/credentials";
import { TenantScopedRepository } from "../tenant-scoped-repository";

export type CredentialStatus = "VALID" | "INVALID" | "UNVERIFIED" | "EXPIRED";

export interface CreateCredentialInput {
  name: string;
  provider: string;
  authenticationType: AuthenticationType;
  encryptedData: string;
}

/** D1/SQLite has no native enum type — `authenticationType`/`status` are plain String
 *  columns at the database level (see schema.prisma). This is the typed shape repository
 *  callers actually see. */
export interface Credential {
  id: string;
  organizationId: string;
  name: string;
  provider: string;
  authenticationType: AuthenticationType;
  encryptedData: string;
  status: CredentialStatus;
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: {
  id: string;
  organizationId: string;
  name: string;
  provider: string;
  authenticationType: string;
  encryptedData: string;
  status: string;
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Credential {
  return {
    ...row,
    authenticationType: row.authenticationType as AuthenticationType,
    status: row.status as CredentialStatus,
  };
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

  async create(input: CreateCredentialInput): Promise<Credential> {
    const row = await this.db.credential.create({
      data: { ...input, organizationId: this.organizationId },
    });
    return toPublic(row);
  }

  async list(): Promise<Credential[]> {
    const rows = await this.db.credential.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPublic);
  }

  async findById(id: string): Promise<Credential | null> {
    const row = await this.db.credential.findFirst({ where: { ...this.scope(), id } });
    return row ? toPublic(row) : null;
  }

  async updateEncryptedData(id: string, encryptedData: string): Promise<Credential | null> {
    if (!(await this.findById(id))) return null;
    const row = await this.db.credential.update({
      where: { id },
      data: { encryptedData, status: "UNVERIFIED", lastValidatedAt: null },
    });
    return toPublic(row);
  }

  async updateStatus(id: string, status: CredentialStatus): Promise<Credential | null> {
    if (!(await this.findById(id))) return null;
    const row = await this.db.credential.update({
      where: { id },
      data: { status, lastValidatedAt: new Date() },
    });
    return toPublic(row);
  }

  /** Returns whether a row was actually deleted (false if it wasn't in this org). */
  async delete(id: string): Promise<boolean> {
    if (!(await this.findById(id))) return false;
    await this.db.credential.delete({ where: { id } });
    return true;
  }
}
