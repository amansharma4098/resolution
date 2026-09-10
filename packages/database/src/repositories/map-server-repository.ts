import type { PrismaClient } from "@prisma/client";
import type { ConnectionStatus, MapServerType } from "@resolution/map-servers";
import { TenantScopedRepository } from "../tenant-scoped-repository";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface CreateMapServerInput {
  type: MapServerType;
  name: string;
  credentialId?: string;
  environments: string[];
  config: Record<string, unknown>;
  isMock: boolean;
}

/** The shape repository callers see — `environments`/`config` parsed back from the
 *  underlying JSON-text String columns; see packages/database/src/json-field.ts. */
export interface MapServer {
  id: string;
  organizationId: string;
  type: MapServerType;
  name: string;
  credentialId: string | null;
  environments: string[];
  config: Record<string, unknown>;
  isMock: boolean;
  status: ConnectionStatus;
  lastHealthCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  credentialId: string | null;
  environments: string;
  config: string;
  isMock: boolean;
  status: string;
  lastHealthCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MapServer {
  return {
    ...row,
    type: row.type as MapServerType,
    status: row.status as ConnectionStatus,
    environments: parseJsonField<string[]>(row.environments, []),
    config: parseJsonField(row.config, {}),
  };
}

/** Same tenant-isolation contract as CredentialRepository — see its header comment. */
export class MapServerRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  async create(input: CreateMapServerInput): Promise<MapServer> {
    const row = await this.db.mapServer.create({
      data: {
        type: input.type,
        name: input.name,
        credentialId: input.credentialId,
        environments: serializeJsonField(input.environments),
        config: serializeJsonField(input.config),
        isMock: input.isMock,
        organizationId: this.organizationId,
      },
    });
    return toPublic(row);
  }

  async list(): Promise<MapServer[]> {
    const rows = await this.db.mapServer.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPublic);
  }

  async findById(id: string): Promise<MapServer | null> {
    const row = await this.db.mapServer.findFirst({ where: { ...this.scope(), id } });
    return row ? toPublic(row) : null;
  }

  async updateStatus(id: string, status: ConnectionStatus): Promise<MapServer | null> {
    if (!(await this.findById(id))) return null;
    const row = await this.db.mapServer.update({
      where: { id },
      data: { status, lastHealthCheckAt: new Date() },
    });
    return toPublic(row);
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.findById(id))) return false;
    await this.db.mapServer.delete({ where: { id } });
    return true;
  }
}
