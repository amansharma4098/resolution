import type { PrismaClient } from "@prisma/client";
import type { RootCauseAnalysisOutput } from "@resolution/shared";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface RootCauseAnalysisRow {
  id: string;
  incidentId: string;
  summary: string;
  claims: RootCauseAnalysisOutput["claims"];
  confidence: number;
  alternativeHypotheses: string[];
  createdAt: Date;
}

function toPublic(row: {
  id: string;
  incidentId: string;
  summary: string;
  claims: string;
  confidence: number;
  alternativeHypotheses: string;
  createdAt: Date;
}): RootCauseAnalysisRow {
  return {
    ...row,
    claims: parseJsonField(row.claims, []),
    alternativeHypotheses: parseJsonField(row.alternativeHypotheses, []),
  };
}

/** Same non-tenant-scoped trust relationship as IncidentEvidenceRepository — see its header
 *  comment. RootCauseAnalysis belongs to an Incident, which is where org-scoping happens. */
export class RootCauseAnalysisRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(incidentId: string, rca: RootCauseAnalysisOutput): Promise<RootCauseAnalysisRow> {
    const row = await this.db.rootCauseAnalysis.create({
      data: {
        incidentId,
        summary: rca.summary,
        claims: serializeJsonField(rca.claims),
        confidence: rca.confidence,
        alternativeHypotheses: serializeJsonField(rca.alternativeHypotheses),
      },
    });
    return toPublic(row);
  }

  async findLatestByIncident(incidentId: string): Promise<RootCauseAnalysisRow | null> {
    const row = await this.db.rootCauseAnalysis.findFirst({
      where: { incidentId },
      orderBy: { createdAt: "desc" },
    });
    return row ? toPublic(row) : null;
  }
}
