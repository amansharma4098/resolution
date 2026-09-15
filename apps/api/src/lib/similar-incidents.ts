import type { IncidentSourceType } from "@resolution/shared";
import type { PrismaClient } from "@resolution/database";
import { IncidentRepository, RootCauseAnalysisRepository, RemediationRepository } from "@resolution/database";

export interface SimilarIncidentSummary {
  id: string;
  title: string;
  service: string | null;
  severity: string;
  resolvedAt: string | null;
  /** Null when the past incident never got a completed RCA (e.g. it was manually resolved). */
  rootCause: string | null;
  actionTaken: string | null;
  /** Lowercased RemediationStatus of the last remediation attempt on the matched incident, or
   *  "not attempted" when no remediation was ever proposed — never fabricated. */
  outcome: string;
  /** Every signal that made this a match — see packages/database/src/similarity.ts. */
  matchedOn: string[];
}

/**
 * Finds past RESOLVED/CLOSED incidents most like `target` and attaches what actually happened
 * to each one (root cause, action taken, outcome) — the "have we seen this before, and what
 * fixed it" context every competitor in this space (incident.io, Rootly, BigPanda) leads
 * with. Shared by the investigation agent (proactive context at investigation start), the
 * `find_similar_incidents` tool (on-demand via chat/MCP), and the incident detail page.
 */
export async function findSimilarIncidentSummaries(
  db: PrismaClient,
  tenantId: string,
  target: { id: string; title: string; service: string | null; affectedSystem: string | null; source: IncidentSourceType },
  limit = 3,
): Promise<SimilarIncidentSummary[]> {
  const incidents = new IncidentRepository(db, tenantId);
  const ranked = await incidents.findSimilarResolved(target, limit);
  if (ranked.length === 0) return [];

  const rcaRepo = new RootCauseAnalysisRepository(db);
  const remediationRepo = new RemediationRepository(db);

  return Promise.all(
    ranked.map(async ({ incident, matchedOn }) => {
      const rca = await rcaRepo.findLatestByIncident(incident.id);
      const resolutions = await remediationRepo.listResolutionsByIncident(incident.id);
      const lastResolution = resolutions[resolutions.length - 1] ?? null;

      let actionTaken: string | null = null;
      let outcome = "not attempted";
      if (lastResolution) {
        actionTaken = lastResolution.proposedAction;
        const actions = await remediationRepo.listRemediationActionsByResolution(lastResolution.id);
        const lastAction = actions[actions.length - 1];
        if (lastAction) outcome = lastAction.status.toLowerCase();
      }

      return {
        id: incident.id,
        title: incident.title,
        service: incident.service,
        severity: incident.severity,
        resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
        rootCause: rca?.summary ?? null,
        actionTaken,
        outcome,
        matchedOn,
      };
    }),
  );
}
