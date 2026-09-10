import type {
  ConnectionStatus,
  MapServer,
  MapServerType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { TenantScopedRepository } from "../tenant-scoped-repository";

export interface CreateMapServerInput {
  type: MapServerType;
  name: string;
  credentialId?: string;
  environments: string[];
  config: Record<string, unknown>;
  isMock: boolean;
}

/** Same tenant-isolation contract as CredentialRepository — see its header comment. */
export class MapServerRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  create(input: CreateMapServerInput): Promise<MapServer> {
    return this.db.mapServer.create({
      data: {
        type: input.type,
        name: input.name,
        credentialId: input.credentialId,
        environments: input.environments,
        config: input.config as Prisma.InputJsonValue,
        isMock: input.isMock,
        organizationId: this.organizationId,
      },
    });
  }

  list(): Promise<MapServer[]> {
    return this.db.mapServer.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
  }

  findById(id: string): Promise<MapServer | null> {
    return this.db.mapServer.findFirst({ where: { ...this.scope(), id } });
  }

  async updateStatus(
    id: string,
    status: ConnectionStatus,
  ): Promise<MapServer | null> {
    if (!(await this.findById(id))) return null;
    return this.db.mapServer.update({
      where: { id },
      data: { status, lastHealthCheckAt: new Date() },
    });
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.findById(id))) return false;
    await this.db.mapServer.delete({ where: { id } });
    return true;
  }
}
