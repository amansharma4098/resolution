import type { PrismaClient } from "@prisma/client";

export interface PostmortemRow {
  id: string;
  incidentId: string;
  content: string;
  isMock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(row: { id: string; incidentId: string; content: string; isMock: boolean; createdAt: Date; updatedAt: Date }): PostmortemRow {
  return row;
}

/** Not a TenantScopedRepository — same trust-via-Incident relationship as
 *  RootCauseAnalysisRepository/RemediationRepository (see their header comments): every
 *  call site here is reached only after the caller has already loaded the parent Incident
 *  through an org-scoped IncidentRepository. One row per incident (`@@unique(incidentId)`),
 *  so drafting a postmortem twice (e.g. a manual "regenerate") replaces it rather than
 *  accumulating duplicates. */
export class PostmortemRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByIncidentId(incidentId: string): Promise<PostmortemRow | null> {
    const row = await this.db.postmortem.findUnique({ where: { incidentId } });
    return row ? toPublic(row) : null;
  }

  async upsertForIncident(incidentId: string, content: string, isMock: boolean): Promise<PostmortemRow> {
    const row = await this.db.postmortem.upsert({
      where: { incidentId },
      create: { incidentId, content, isMock },
      update: { content, isMock },
    });
    return toPublic(row);
  }
}
