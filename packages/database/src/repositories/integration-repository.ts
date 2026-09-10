import type { PrismaClient } from "@prisma/client";
import type { IncidentSourceType } from "@resolution/shared";
import type { ConnectionStatus } from "@resolution/map-servers";
import { TenantScopedRepository } from "../tenant-scoped-repository";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface CreateIntegrationInput {
  type: IncidentSourceType;
  name: string;
  credentialId?: string;
  config: Record<string, unknown>;
}

/** The shape repository callers see — `config` parsed back to an object. D1/SQLite has no
 *  native JSON column type, so the underlying Prisma row stores it as a JSON-text String;
 *  see packages/database/src/json-field.ts. */
export interface Integration {
  id: string;
  organizationId: string;
  type: IncidentSourceType;
  name: string;
  credentialId: string | null;
  config: Record<string, unknown>;
  status: ConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  credentialId: string | null;
  config: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Integration {
  return {
    ...row,
    type: row.type as IncidentSourceType,
    status: row.status as ConnectionStatus,
    config: parseJsonField(row.config, {}),
  };
}

/** Same tenant-isolation contract as CredentialRepository — see its header comment. */
export class IntegrationRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  async create(input: CreateIntegrationInput): Promise<Integration> {
    const row = await this.db.integration.create({
      data: {
        type: input.type,
        name: input.name,
        credentialId: input.credentialId,
        config: serializeJsonField(input.config),
        organizationId: this.organizationId,
      },
    });
    return toPublic(row);
  }

  async list(): Promise<Integration[]> {
    const rows = await this.db.integration.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPublic);
  }

  async findById(id: string): Promise<Integration | null> {
    const row = await this.db.integration.findFirst({ where: { ...this.scope(), id } });
    return row ? toPublic(row) : null;
  }

  async updateStatus(id: string, status: ConnectionStatus): Promise<Integration | null> {
    if (!(await this.findById(id))) return null;
    const row = await this.db.integration.update({ where: { id }, data: { status } });
    return toPublic(row);
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.findById(id))) return false;
    await this.db.integration.delete({ where: { id } });
    return true;
  }
}
