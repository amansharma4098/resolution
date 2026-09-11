import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import {
  IncidentRepository,
  IncidentEvidenceRepository,
  RootCauseAnalysisRepository,
  RemediationRepository,
  MapServerRepository,
  auditLogWriter,
  parseJsonField,
} from "@resolution/database";
import type { OrganizationRepository } from "@resolution/database";
import { getMapServerProvider } from "@resolution/map-servers";
import { canTransition, transition } from "@resolution/agents";
import { writeAuditLog } from "@resolution/security";
import type { SecretProvider } from "@resolution/credentials";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError, ConflictError, ValidationError } from "../lib/errors";
import type { AppEnv } from "../types";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";
import { executeAndVerify } from "../queue/remediation-consumer";

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

  router.get("/", auth, tenantContext, async (c) => {
    const incidents = new IncidentRepository(db, c.get("organizationId")!);
    const list = await incidents.list();
    return c.json({ incidents: list });
  });

  // Registered ahead of "/:id" — a literal "approvals" segment here would otherwise be
  // swallowed by the param route (the same Hono route-matching lesson noted in
  // map-servers.ts's "/catalog" and organizations.ts's "/members"). Powers a global
  // approvals inbox so an admin doesn't have to open every incident to find what's waiting
  // on them. O(incidents) round trips, not a single join query — Resolution/RemediationAction/
  // Approval have no organizationId column of their own to query against directly (same
  // trust-via-Incident relationship as IncidentEvidence/RootCauseAnalysis), and this
  // project's scale doesn't yet justify a denormalized index for it; worth revisiting once
  // real incident volume exists.
  router.get("/approvals/pending", auth, tenantContext, async (c) => {
    const organizationId = c.get("organizationId")!;
    const incidents = new IncidentRepository(db, organizationId);
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
    const incidents = new IncidentRepository(db, c.get("organizationId")!);
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

    return c.json({ incident, evidence, rca, events, resolutions: resolutionsWithActions });
  });

  router.post("/:id/investigate", auth, tenantContext, async (c) => {
    const organizationId = c.get("organizationId")!;
    const incidents = new IncidentRepository(db, organizationId);
    const incident = await incidents.findById(c.req.param("id"));
    if (!incident) throw new NotFoundError("Incident not found");

    if (!canTransition(incident.status, "INVESTIGATING")) {
      throw new ConflictError(`Cannot start an investigation from status ${incident.status}`);
    }

    await investigationQueue.send({ incidentId: incident.id, organizationId });
    return c.json({ status: "investigating" }, 202);
  });

  router.post("/:id/propose-remediation", auth, tenantContext, async (c) => {
    const organizationId = c.get("organizationId")!;
    const incidents = new IncidentRepository(db, organizationId);
    const incident = await incidents.findById(c.req.param("id"));
    if (!incident) throw new NotFoundError("Incident not found");

    if (incident.status !== "RCA_COMPLETE") {
      throw new ConflictError(`Cannot propose a remediation from status ${incident.status} — needs RCA_COMPLETE`);
    }

    await remediationQueue.send({ incidentId: incident.id, organizationId });
    return c.json({ status: "proposing" }, 202);
  });

  router.post("/:id/approvals/:approvalId/decide", auth, tenantContext, requireAdmin, async (c) => {
    const organizationId = c.get("organizationId")!;
    const incidents = new IncidentRepository(db, organizationId);
    const incident = await incidents.findById(c.req.param("id"));
    if (!incident) throw new NotFoundError("Incident not found");

    const remediationRepo = new RemediationRepository(db);
    const approval = await remediationRepo.findApprovalById(c.req.param("approvalId"));
    if (!approval) throw new NotFoundError("Approval not found");

    const action = await remediationRepo.findRemediationActionById(approval.remediationActionId);
    if (!action) throw new NotFoundError("Remediation action not found");
    const resolution = await remediationRepo.findResolutionById(action.resolutionId);
    if (!resolution || resolution.incidentId !== incident.id) throw new NotFoundError("Approval not found");

    if (approval.status !== "PENDING") {
      throw new ConflictError(`This approval was already ${approval.status.toLowerCase()}`);
    }
    if (incident.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Incident is no longer awaiting approval (status: ${incident.status})`);
    }

    const body = DecideApprovalBody.parse(await c.req.json());
    const decided = await remediationRepo.decideApproval(approval.id, {
      status: body.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedByUserId: c.get("userId")!,
      reason: body.reason,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId,
      actorType: "user",
      actorId: c.get("userId"),
      action: body.decision === "APPROVE" ? "remediation.approved" : "remediation.rejected",
      targetType: "RemediationAction",
      targetId: action.id,
      requestId: c.get("requestId"),
      metadata: { reason: body.reason },
    });

    if (body.decision === "REJECT") {
      await db.incident.update({
        where: { id: incident.id },
        data: { status: transition(incident.status, "CLOSED") },
      });
      await db.incidentEvent.create({
        data: {
          incidentId: incident.id,
          type: "approval_rejected",
          actor: c.get("userId")!,
          detail: JSON.stringify({ reason: body.reason ?? null }),
        },
      });
      return c.json({ approval: decided, status: "REJECTED" });
    }

    if (!resolution.mapServerId || !resolution.capabilityKey) {
      throw new ValidationError("This resolution has no capability to execute");
    }
    const mapServers = new MapServerRepository(db, organizationId);
    const mapServer = await mapServers.findById(resolution.mapServerId);
    if (!mapServer) throw new ValidationError("The Map Server for this resolution no longer exists");
    const provider = getMapServerProvider(mapServer.type);
    const capability = provider?.capabilities.find((cap) => cap.key === resolution.capabilityKey);
    if (!provider || !capability) {
      throw new ValidationError("The capability for this resolution is no longer available");
    }

    await db.incident.update({
      where: { id: incident.id },
      data: { status: transition(incident.status, "REMEDIATING") },
    });
    await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "approval_granted",
        actor: c.get("userId")!,
        detail: JSON.stringify({ reason: body.reason ?? null }),
      },
    });

    // Executed synchronously in the request — a single capability call plus a short bounded
    // verification loop (packages/agents' verification-runner, a few seconds at most), not
    // re-queued. See remediation-consumer.ts's header comment on why the AUTO path already
    // does the same thing inline rather than round-tripping through another queue message.
    await executeAndVerify(db, {
      organizationId,
      incidentId: incident.id,
      mapServerId: resolution.mapServerId,
      mapServerType: mapServer.type,
      capability,
      input: resolution.input,
      remediationActionId: action.id,
      secretProvider,
    });

    return c.json({ approval: decided, status: "EXECUTED" });
  });

  return router;
}
