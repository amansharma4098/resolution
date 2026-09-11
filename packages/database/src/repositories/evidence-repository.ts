import type { PrismaClient } from "@prisma/client";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface CreateEvidenceInput {
  incidentId: string;
  // EvidenceType: LOG | METRIC | CONFIG | API_RESPONSE | PIPELINE_RUN | TRACE | OTHER
  type: string;
  source: string; // Map Server id, or "manual"
  capabilityKey?: string;
  summary: string;
  payload: unknown;
}

export interface IncidentEvidenceRow {
  id: string;
  incidentId: string;
  type: string;
  source: string;
  capabilityKey: string | null;
  summary: string;
  payload: unknown;
  collectedAt: Date;
}

function toPublic(row: {
  id: string;
  incidentId: string;
  type: string;
  source: string;
  capabilityKey: string | null;
  summary: string;
  payload: string;
  collectedAt: Date;
}): IncidentEvidenceRow {
  return { ...row, payload: parseJsonField(row.payload, {}) };
}

/**
 * Not a TenantScopedRepository — IncidentEvidence has no organizationId column of its own
 * (schema.prisma: it belongs to an Incident, which does). Every call site here is reached
 * only after the caller has already loaded the parent Incident through an org-scoped
 * IncidentRepository — that lookup is the actual tenant-isolation boundary for this table,
 * the same trust relationship IncidentEvent already has to Incident.
 */
export class IncidentEvidenceRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateEvidenceInput): Promise<IncidentEvidenceRow> {
    const row = await this.db.incidentEvidence.create({
      data: {
        incidentId: input.incidentId,
        type: input.type,
        source: input.source,
        capabilityKey: input.capabilityKey,
        summary: input.summary,
        payload: serializeJsonField(input.payload),
      },
    });
    return toPublic(row);
  }

  async listByIncident(incidentId: string): Promise<IncidentEvidenceRow[]> {
    const rows = await this.db.incidentEvidence.findMany({
      where: { incidentId },
      orderBy: { collectedAt: "asc" },
    });
    return rows.map(toPublic);
  }
}
