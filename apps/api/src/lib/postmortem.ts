import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  IncidentEvidenceRepository,
  RootCauseAnalysisRepository,
  RemediationRepository,
  PostmortemRepository,
  auditLogWriter,
} from "@resolution/database";
import { draftPostmortem, type LlmClient, type PostmortemInput } from "@resolution/ai";
import { writeAuditLog } from "@resolution/security";
import { NotFoundError } from "./errors";

/**
 * Drafts (or redrafts) a postmortem for one incident from its complete real record — RCA,
 * evidence, remediation history, timeline — and persists it. Called automatically the
 * moment an incident reaches RESOLVED (remediation-consumer.ts, at all three points that
 * transition there — see its header comment on why "resolved" isn't a single line of code)
 * and available as a manual regenerate (routes/incidents.ts, the `regenerate_postmortem`
 * tool) for after a human edits the RCA or just wants a fresh draft.
 *
 * Deliberately swallow-and-log rather than throw when called from the automatic path: a
 * drafting failure (a flaky LLM call, say) must never undo or block the incident actually
 * being marked RESOLVED — see the try/catch at each call site in remediation-consumer.ts.
 */
export async function generatePostmortem(
  deps: { db: PrismaClient; llmClient: LlmClient },
  params: { tenantId: string; incidentId: string },
): Promise<{ content: string; isMock: boolean }> {
  const { db, llmClient } = deps;
  const incidents = new IncidentRepository(db, params.tenantId);
  const incident = await incidents.findById(params.incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  const rca = await new RootCauseAnalysisRepository(db).findLatestByIncident(incident.id);
  const evidence = await new IncidentEvidenceRepository(db).listByIncident(incident.id);
  const remediationRepo = new RemediationRepository(db);
  const resolutions = await remediationRepo.listResolutionsByIncident(incident.id);
  const resolutionsWithOutcome = await Promise.all(
    resolutions.map(async (r) => {
      const actions = await remediationRepo.listRemediationActionsByResolution(r.id);
      const lastAction = actions[actions.length - 1];
      return { proposedAction: r.proposedAction, riskLevel: r.riskLevel, outcome: lastAction ? lastAction.status.toLowerCase() : "not executed" };
    }),
  );
  const eventRows = await db.incidentEvent.findMany({ where: { incidentId: incident.id }, orderBy: { createdAt: "asc" } });

  const input: PostmortemInput = {
    incident: {
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      priority: incident.priority,
      source: incident.source,
      service: incident.service,
      createdAt: incident.createdAt.toISOString(),
      resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    },
    rca: rca ? { summary: rca.summary, claims: rca.claims, confidence: rca.confidence } : null,
    evidence: evidence.map((e) => ({ capabilityKey: e.capabilityKey, summary: e.summary })),
    resolutions: resolutionsWithOutcome,
    timeline: eventRows.map((e) => ({ type: e.type, actor: e.actor, createdAt: e.createdAt.toISOString() })),
  };

  const result = await draftPostmortem(llmClient, input);
  await new PostmortemRepository(db).upsertForIncident(incident.id, result.content, result.isMock);

  await writeAuditLog(auditLogWriter(db), {
    tenantId: params.tenantId,
    actorType: "agent",
    action: "incident.postmortem_drafted",
    targetType: "Incident",
    targetId: incident.id,
    metadata: { mock: result.isMock },
  });

  return result;
}
