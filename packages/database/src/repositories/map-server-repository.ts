import type { PrismaClient } from "@prisma/client";
import type { AnyCapability, ConnectionStatus, MapServerType } from "@resolution/map-servers";
import { TenantScopedRepository } from "../tenant-scoped-repository";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface MapServerCapabilityRow {
  id: string;
  mapServerId: string;
  key: string;
  enabled: boolean;
  riskLevel: string;
  mutating: boolean;
}

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

  /**
   * Closes the loop Phase 2 deferred: "there's nothing real to toggle until Phase 5
   * registers a provider with actual capabilities" (IMPLEMENTATION_PLAN.md). Called once,
   * right after creating a MapServer, only when a provider is actually registered for its
   * type — every capability starts `enabled: false` (ARCHITECTURE.md §4: a capability the
   * org hasn't explicitly enabled is invisible to the agent). Uses the batch
   * `$transaction([...])` form, not interactive — D1 doesn't support the latter (see
   * OrganizationRepository.createWithOwner's comment).
   */
  async createCapabilitiesFromProvider(
    mapServerId: string,
    providerCapabilities: AnyCapability[],
  ): Promise<void> {
    if (providerCapabilities.length === 0) return;
    await this.db.$transaction(
      providerCapabilities.map((cap) =>
        this.db.mapServerCapability.create({
          data: {
            mapServerId,
            key: cap.key,
            riskLevel: cap.riskLevel,
            mutating: cap.mutating,
            enabled: false,
          },
        }),
      ),
    );
  }

  /** No org-scoping needed beyond the caller already having proven ownership of
   *  `mapServerId` via `findById` — capabilities have no organizationId of their own
   *  (they belong to a MapServer, which does). */
  async listCapabilities(mapServerId: string): Promise<MapServerCapabilityRow[]> {
    return this.db.mapServerCapability.findMany({
      where: { mapServerId },
      orderBy: { key: "asc" },
    });
  }

  async setCapabilityEnabled(
    mapServerId: string,
    key: string,
    enabled: boolean,
  ): Promise<MapServerCapabilityRow | null> {
    const existing = await this.db.mapServerCapability.findUnique({
      where: { mapServerId_key: { mapServerId, key } },
    });
    if (!existing) return null;
    return this.db.mapServerCapability.update({
      where: { mapServerId_key: { mapServerId, key } },
      data: { enabled },
    });
  }
}
