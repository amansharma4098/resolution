import type {
  ConnectionStatus,
  Integration,
  IncidentSourceType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { TenantScopedRepository } from "../tenant-scoped-repository";

export interface CreateIntegrationInput {
  type: IncidentSourceType;
  name: string;
  credentialId?: string;
  config: Record<string, unknown>;
}

/** Same tenant-isolation contract as CredentialRepository — see its header comment. */
export class IntegrationRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  create(input: CreateIntegrationInput): Promise<Integration> {
    return this.db.integration.create({
      data: {
        ...input,
        config: input.config as Prisma.InputJsonValue,
        organizationId: this.organizationId,
      },
    });
  }

  list(): Promise<Integration[]> {
    return this.db.integration.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
  }

  findById(id: string): Promise<Integration | null> {
    return this.db.integration.findFirst({ where: { ...this.scope(), id } });
  }

  async updateStatus(id: string, status: ConnectionStatus): Promise<Integration | null> {
    if (!(await this.findById(id))) return null;
    return this.db.integration.update({ where: { id }, data: { status } });
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.findById(id))) return false;
    await this.db.integration.delete({ where: { id } });
    return true;
  }
}
