import type { PrismaClient } from "@prisma/client";
import type { MapServerType } from "@resolution/map-servers";
import type { PolicyBehavior, ResolutionMode, RiskLevel } from "@resolution/shared";
import { TenantScopedRepository } from "../tenant-scoped-repository";

export interface UpsertAutomationPolicyInput {
  mapServerType: MapServerType;
  capabilityKey: string;
  riskLevel: RiskLevel;
  behavior: PolicyBehavior;
  resolutionModeFloor: ResolutionMode;
}

export interface AutomationPolicyRow {
  id: string;
  organizationId: string;
  mapServerType: MapServerType;
  capabilityKey: string;
  riskLevel: RiskLevel;
  behavior: PolicyBehavior;
  resolutionModeFloor: ResolutionMode;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: {
  id: string;
  organizationId: string;
  mapServerType: string;
  capabilityKey: string;
  riskLevel: string;
  behavior: string;
  resolutionModeFloor: string;
  createdAt: Date;
  updatedAt: Date;
}): AutomationPolicyRow {
  return {
    ...row,
    mapServerType: row.mapServerType as MapServerType,
    riskLevel: row.riskLevel as RiskLevel,
    behavior: row.behavior as PolicyBehavior,
    resolutionModeFloor: row.resolutionModeFloor as ResolutionMode,
  };
}

/** Same tenant-isolation contract as the other TenantScopedRepositorys — see
 *  CredentialRepository's header comment. */
export class AutomationPolicyRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  async list(): Promise<AutomationPolicyRow[]> {
    const rows = await this.db.automationPolicy.findMany({
      where: this.scope(),
      orderBy: [{ mapServerType: "asc" }, { capabilityKey: "asc" }],
    });
    return rows.map(toPublic);
  }

  async findForCapability(mapServerType: MapServerType, capabilityKey: string): Promise<AutomationPolicyRow | null> {
    const row = await this.db.automationPolicy.findUnique({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: this.organizationId,
          mapServerType,
          capabilityKey,
        },
      },
    });
    return row ? toPublic(row) : null;
  }

  /** Upsert on the (organizationId, mapServerType, capabilityKey) unique constraint — an
   *  admin setting a policy for a capability that already has one updates it in place
   *  rather than erroring or creating a duplicate. */
  async upsert(input: UpsertAutomationPolicyInput): Promise<AutomationPolicyRow> {
    const row = await this.db.automationPolicy.upsert({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: this.organizationId,
          mapServerType: input.mapServerType,
          capabilityKey: input.capabilityKey,
        },
      },
      create: { ...input, organizationId: this.organizationId },
      update: {
        riskLevel: input.riskLevel,
        behavior: input.behavior,
        resolutionModeFloor: input.resolutionModeFloor,
      },
    });
    return toPublic(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.db.automationPolicy.findFirst({ where: { ...this.scope(), id } });
    if (!existing) return false;
    await this.db.automationPolicy.delete({ where: { id } });
    return true;
  }
}
