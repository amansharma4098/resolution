import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { IncidentRepository, RemediationRepository } from "@resolution/database";
import type { OrganizationRepository } from "@resolution/database";
import type { IncidentStatus } from "@resolution/shared";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { resolveTenantContext } from "../middleware/tenant-context";
import type { AppEnv } from "../types";

const TERMINAL_STATUSES: ReadonlySet<IncidentStatus> = new Set(["RESOLVED", "CLOSED"]);
const OPEN_ORDER: IncidentStatus[] = [
  "NEW",
  "INVESTIGATING",
  "RCA_COMPLETE",
  "PENDING_APPROVAL",
  "REMEDIATING",
  "VERIFYING",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
  "FAILED",
];

/**
 * Computed live from Incident/Resolution/RemediationAction/Approval rows on every request —
 * not a `UsageMetric` rollup table. A precomputed rollup (populated by a scheduled job) is
 * real, deferred scope: this project's current data volume doesn't justify it yet, and
 * Phase 11's usage-based billing is the point at which a rollup job earns its keep (it needs
 * one anyway, for metering). Same O(incidents) round-trip pattern as the approvals inbox
 * (`GET /api/incidents/approvals/pending`) — acceptable at this scale, documented as a
 * scaling gap there and here rather than silently accepted.
 */
export function buildMetricsRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);

  router.get("/", auth, tenantContext, async (c) => {
    const organizationId = c.get("organizationId")!;
    const incidents = new IncidentRepository(db, organizationId);
    const remediationRepo = new RemediationRepository(db);
    const allIncidents = await incidents.list();

    const byStatus = Object.fromEntries(OPEN_ORDER.map((s) => [s, 0])) as Record<IncidentStatus, number>;
    let resolvedCount = 0;
    let resolutionTimeTotalMs = 0;

    for (const incident of allIncidents) {
      byStatus[incident.status] += 1;
      if (incident.status === "RESOLVED" && incident.resolvedAt) {
        resolvedCount += 1;
        resolutionTimeTotalMs += incident.resolvedAt.getTime() - incident.createdAt.getTime();
      }
    }
    const open = allIncidents.filter((i) => !TERMINAL_STATUSES.has(i.status)).length;

    const remediation = {
      proposed: 0,
      deniedByPolicy: 0,
      approvalPending: 0,
      approved: 0,
      rejected: 0,
      executing: 0,
      succeeded: 0,
      failed: 0,
      noActionCount: 0,
    };

    for (const incident of allIncidents) {
      const resolutions = await remediationRepo.listResolutionsByIncident(incident.id);
      for (const resolution of resolutions) {
        remediation.proposed += 1;
        const actions = await remediationRepo.listRemediationActionsByResolution(resolution.id);
        for (const action of actions) {
          const approval = await remediationRepo.findApprovalByRemediationActionId(action.id);
          if (!approval && action.status === "PENDING") {
            remediation.deniedByPolicy += 1;
          } else if (approval) {
            if (approval.status === "PENDING") remediation.approvalPending += 1;
            else if (approval.status === "REJECTED") remediation.rejected += 1;
            else if (approval.status === "APPROVED") remediation.approved += 1;
          }
          if (action.status === "EXECUTING") remediation.executing += 1;
          else if (action.status === "SUCCEEDED") remediation.succeeded += 1;
          else if (action.status === "FAILED") remediation.failed += 1;
        }
      }
    }

    for (const incident of allIncidents) {
      const events = await db.incidentEvent.findMany({ where: { incidentId: incident.id } });
      remediation.noActionCount += events.filter((e) => e.type === "remediation_not_proposed").length;
    }

    return c.json({
      incidents: {
        total: allIncidents.length,
        open,
        byStatus,
        avgResolutionTimeMs: resolvedCount > 0 ? Math.round(resolutionTimeTotalMs / resolvedCount) : null,
      },
      remediation,
    });
  });

  return router;
}
