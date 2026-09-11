import type { PrismaClient } from "@prisma/client";
import type { ApprovalStatus, RemediationStatus, RiskLevel, VerificationStatus } from "@resolution/shared";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface CreateResolutionInput {
  incidentId: string;
  rcaId: string;
  proposedAction: string;
  mapServerId?: string;
  capabilityKey?: string;
  input: unknown;
  riskLevel: RiskLevel;
}

export interface ResolutionRow {
  id: string;
  incidentId: string;
  rcaId: string;
  proposedAction: string;
  mapServerId: string | null;
  capabilityKey: string | null;
  input: unknown;
  riskLevel: RiskLevel;
  createdAt: Date;
}

export interface RemediationActionRow {
  id: string;
  resolutionId: string;
  status: RemediationStatus;
  idempotencyKey: string;
  executedAt: Date | null;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRow {
  id: string;
  remediationActionId: string;
  status: ApprovalStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  reason: string | null;
}

export interface VerificationRow {
  id: string;
  remediationActionId: string;
  status: VerificationStatus;
  expectedState: unknown;
  actualState: unknown;
  attempt: number;
  checkedAt: Date;
}

function toResolution(row: {
  id: string;
  incidentId: string;
  rcaId: string;
  proposedAction: string;
  mapServerId: string | null;
  capabilityKey: string | null;
  input: string;
  riskLevel: string;
  createdAt: Date;
}): ResolutionRow {
  return { ...row, input: parseJsonField(row.input, {}), riskLevel: row.riskLevel as RiskLevel };
}

function toRemediationAction(row: {
  id: string;
  resolutionId: string;
  status: string;
  idempotencyKey: string;
  executedAt: Date | null;
  result: string;
  createdAt: Date;
  updatedAt: Date;
}): RemediationActionRow {
  return { ...row, status: row.status as RemediationStatus, result: parseJsonField(row.result, {}) };
}

function toApproval(row: {
  id: string;
  remediationActionId: string;
  status: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  reason: string | null;
}): ApprovalRow {
  return { ...row, status: row.status as ApprovalStatus };
}

function toVerification(row: {
  id: string;
  remediationActionId: string;
  status: string;
  expectedState: string;
  actualState: string;
  attempt: number;
  checkedAt: Date;
}): VerificationRow {
  return {
    ...row,
    status: row.status as VerificationStatus,
    expectedState: parseJsonField(row.expectedState, {}),
    actualState: parseJsonField(row.actualState, {}),
  };
}

/**
 * Not a TenantScopedRepository — none of these four tables carry organizationId directly
 * (Resolution belongs to Incident, RemediationAction to Resolution, Approval/Verification to
 * RemediationAction). Same trust relationship as IncidentEvidenceRepository/
 * RootCauseAnalysisRepository: every call site here is reached only after the caller has
 * already loaded the parent Incident through an org-scoped IncidentRepository.
 *
 * Kept as one repository across all four tables (rather than four files) because Phase 8's
 * remediation flow always operates on them together — a Resolution is never read without
 * its RemediationAction, an Approval always belongs to exactly one RemediationAction, and so
 * on; splitting them wouldn't reduce coupling, just spread it across more imports.
 */
export class RemediationRepository {
  constructor(private readonly db: PrismaClient) {}

  async createResolution(input: CreateResolutionInput): Promise<ResolutionRow> {
    const row = await this.db.resolution.create({
      data: { ...input, input: serializeJsonField(input.input) },
    });
    return toResolution(row);
  }

  async findResolutionById(id: string): Promise<ResolutionRow | null> {
    const row = await this.db.resolution.findUnique({ where: { id } });
    return row ? toResolution(row) : null;
  }

  async listResolutionsByIncident(incidentId: string): Promise<ResolutionRow[]> {
    const rows = await this.db.resolution.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } });
    return rows.map(toResolution);
  }

  /** RemediationStatus starts PENDING always — the policy engine decides afterward whether
   *  it can move straight to EXECUTING (AUTO) or needs an Approval row first (APPROVAL). */
  async createRemediationAction(resolutionId: string, idempotencyKey: string): Promise<RemediationActionRow> {
    const row = await this.db.remediationAction.create({
      data: { resolutionId, idempotencyKey, status: "PENDING" },
    });
    return toRemediationAction(row);
  }

  async findRemediationActionById(id: string): Promise<RemediationActionRow | null> {
    const row = await this.db.remediationAction.findUnique({ where: { id } });
    return row ? toRemediationAction(row) : null;
  }

  async listRemediationActionsByResolution(resolutionId: string): Promise<RemediationActionRow[]> {
    const rows = await this.db.remediationAction.findMany({ where: { resolutionId } });
    return rows.map(toRemediationAction);
  }

  async updateRemediationActionStatus(
    id: string,
    status: RemediationStatus,
    opts: { executedAt?: Date; result?: unknown } = {},
  ): Promise<RemediationActionRow> {
    const row = await this.db.remediationAction.update({
      where: { id },
      data: {
        status,
        ...(opts.executedAt ? { executedAt: opts.executedAt } : {}),
        ...(opts.result !== undefined ? { result: serializeJsonField(opts.result) } : {}),
      },
    });
    return toRemediationAction(row);
  }

  async createApproval(remediationActionId: string): Promise<ApprovalRow> {
    const row = await this.db.approval.create({ data: { remediationActionId, status: "PENDING" } });
    return toApproval(row);
  }

  async findApprovalById(id: string): Promise<ApprovalRow | null> {
    const row = await this.db.approval.findUnique({ where: { id } });
    return row ? toApproval(row) : null;
  }

  async findApprovalByRemediationActionId(remediationActionId: string): Promise<ApprovalRow | null> {
    const row = await this.db.approval.findUnique({ where: { remediationActionId } });
    return row ? toApproval(row) : null;
  }

  async decideApproval(
    id: string,
    decision: { status: "APPROVED" | "REJECTED"; decidedByUserId: string; reason?: string },
  ): Promise<ApprovalRow> {
    const row = await this.db.approval.update({
      where: { id },
      data: {
        status: decision.status,
        decidedAt: new Date(),
        decidedByUserId: decision.decidedByUserId,
        reason: decision.reason,
      },
    });
    return toApproval(row);
  }

  async createVerification(
    remediationActionId: string,
    input: { status: VerificationStatus; expectedState: unknown; actualState: unknown; attempt: number },
  ): Promise<VerificationRow> {
    const row = await this.db.verification.create({
      data: {
        remediationActionId,
        status: input.status,
        expectedState: serializeJsonField(input.expectedState),
        actualState: serializeJsonField(input.actualState),
        attempt: input.attempt,
      },
    });
    return toVerification(row);
  }

  async listVerifications(remediationActionId: string): Promise<VerificationRow[]> {
    const rows = await this.db.verification.findMany({
      where: { remediationActionId },
      orderBy: { checkedAt: "asc" },
    });
    return rows.map(toVerification);
  }
}
