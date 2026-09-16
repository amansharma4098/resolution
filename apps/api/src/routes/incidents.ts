import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  IncidentEvidenceRepository,
  RootCauseAnalysisRepository,
  RemediationRepository,
  PostmortemRepository,
  parseJsonField,
} from "@resolution/database";
import type { OrganizationRepository } from "@resolution/database";
import type { SecretProvider } from "@resolution/credentials";
import { createLlmClient } from "@resolution/ai";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";
import { investigateIncident, proposeRemediationForIncident, decideRemediationApproval } from "../lib/incident-actions";
import { findSimilarIncidentSummaries } from "../lib/similar-incidents";
import { generatePostmortem } from "../lib/postmortem";

const DecideApprovalBody = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().max(2000).optional(),
});

/**
 * `/investigate` and `/propose-remediation` are manual triggers for Phases 7/8's agents —
 * the primary path is automatic (webhook ingestion → investigation → remediation, chained
 * via each queue consumer's completion hook). These exist for re-running a stage after an
 * ESCALATED/FAILED outcome or a denial, which the state machine allows but nothing
 * auto-retries. `/approvals/:approvalId/decide` is where a human actually approves or
 * rejects an APPROVAL-gated remediation (ARCHITECTURE.md §7).
 */
export function buildIncidentRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
  investigationQueue: IncidentInvestigationQueue;
  remediationQueue: IncidentRemediationQueue;
  secretProvider: SecretProvider;
}): Hono<AppEnv> {
  const { db, env, organizationRepository, investigationQueue, remediationQueue, secretProvider } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");
  // Used only for postmortem drafting (below and on approval-decide, via executeAndVerify) —
  // the investigation/remediation agents build their own LlmClient independently
  // (queue/*-consumer.ts), same separation of concerns as routes/chat.ts's own client.
  const llmClient = createLlmClient({ mockMode: env.MOCK_MODE, apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });

  router.get("/", auth, tenantContext, async (c) => {
    const incidents = new IncidentRepository(db, c.get("tenantId")!);
    const list = await incidents.list();
    return c.json({ incidents: list });
  });

  // Registered ahead of "/:id" — a literal "approvals" segment here would otherwise be
  // swallowed by the param route (the same Hono route-matching lesson noted in
  // map-servers.ts's "/catalog" and organizations.ts's "/members"). Powers a global
  // approvals inbox so an admin doesn't have to open every incident to find what's waiting
  // on them. O(incidents) round trips, not a single join query — Resolution/RemediationAction/
  // Approval have no tenantId column of their own to query against directly (same
  // trust-via-Incident relationship as IncidentEvidence/RootCauseAnalysis), and this
  // project's scale doesn't yet justify a denormalized index for it; worth revisiting once
  // real incident volume exists.
  router.get("/approvals/pending", auth, tenantContext, async (c) => {
    const tenantId = c.get("tenantId")!;
    const incidents = new IncidentRepository(db, tenantId);
    const remediationRepo = new RemediationRepository(db);
    const allIncidents = await incidents.list();

    const pending: {
      incidentId: string;
      incidentTitle: string;
      incidentSeverity: string;
      approvalId: string;
      proposedAction: string;
      riskLevel: string;
      requestedAt: Date;
    }[] = [];

    for (const incident of allIncidents) {
      if (incident.status !== "PENDING_APPROVAL") continue;
      const resolutions = await remediationRepo.listResolutionsByIncident(incident.id);
      for (const resolution of resolutions) {
        const actions = await remediationRepo.listRemediationActionsByResolution(resolution.id);
        for (const action of actions) {
          const approval = await remediationRepo.findApprovalByRemediationActionId(action.id);
          if (approval && approval.status === "PENDING") {
            pending.push({
              incidentId: incident.id,
              incidentTitle: incident.title,
              incidentSeverity: incident.severity,
              approvalId: approval.id,
              proposedAction: resolution.proposedAction,
              riskLevel: resolution.riskLevel,
              requestedAt: approval.requestedAt,
            });
          }
        }
      }
    }

    return c.json({ pending });
  });

  router.get("/:id", auth, tenantContext, async (c) => {
    const incidents = new IncidentRepository(db, c.get("tenantId")!);
    const incident = await incidents.findById(c.req.param("id"));
    if (!incident) throw new NotFoundError("Incident not found");

    const evidence = await new IncidentEvidenceRepository(db).listByIncident(incident.id);
    const rca = await new RootCauseAnalysisRepository(db).findLatestByIncident(incident.id);
    const eventRows = await db.incidentEvent.findMany({
      where: { incidentId: incident.id },
      orderBy: { createdAt: "asc" },
    });
    const events = eventRows.map((e) => ({ ...e, detail: parseJsonField(e.detail, {}) }));

    const remediationRepo = new RemediationRepository(db);
    const resolutions = await remediationRepo.listResolutionsByIncident(incident.id);
    const resolutionsWithActions = await Promise.all(
      resolutions.map(async (resolution) => {
        const actions = await remediationRepo.listRemediationActionsByResolution(resolution.id);
        const actionsWithDetail = await Promise.all(
          actions.map(async (action) => ({
            ...action,
            approval: await remediationRepo.findApprovalByRemediationActionId(action.id),
            verifications: await remediationRepo.listVerifications(action.id),
          })),
        );
        return { ...resolution, actions: actionsWithDetail };
      }),
    );

    const similarIncidents = await findSimilarIncidentSummaries(db, c.get("tenantId")!, incident);
    const postmortem = await new PostmortemRepository(db).findByIncidentId(incident.id);

    return c.json({ incident, evidence, rca, events, resolutions: resolutionsWithActions, similarIncidents, postmortem });
  });

  // A manual (re)draft — the automatic path (executeAndVerify, at the moment an incident
  // reaches RESOLVED) covers the common case, but a human may want a fresh draft after
  // editing the RCA, or a draft before the incident is fully resolved to see where things
  // stand. Regenerating replaces any existing postmortem (PostmortemRepository.upsertForIncident).
  router.post("/:id/postmortem/regenerate", auth, tenantContext, async (c) => {
    const result = await generatePostmortem({ db, llmClient }, { tenantId: c.get("tenantId")!, incidentId: c.req.param("id") });
    return c.json(result);
  });

  router.post("/:id/investigate", auth, tenantContext, async (c) => {
    const result = await investigateIncident(
      { db, investigationQueue },
      { tenantId: c.get("tenantId")!, incidentId: c.req.param("id") },
    );
    return c.json(result, 202);
  });

  router.post("/:id/propose-remediation", auth, tenantContext, async (c) => {
    const result = await proposeRemediationForIncident(
      { db, remediationQueue },
      { tenantId: c.get("tenantId")!, incidentId: c.req.param("id") },
    );
    return c.json(result, 202);
  });

  router.post("/:id/approvals/:approvalId/decide", auth, tenantContext, requireAdmin, async (c) => {
    const body = DecideApprovalBody.parse(await c.req.json());
    const result = await decideRemediationApproval(
      { db, secretProvider, llmClient },
      {
        tenantId: c.get("tenantId")!,
        incidentId: c.req.param("id"),
        approvalId: c.req.param("approvalId"),
        decision: body.decision,
        reason: body.reason,
        actorUserId: c.get("userId")!,
        requestId: c.get("requestId"),
      },
    );
    return c.json(result);
  });

  return router;
}
