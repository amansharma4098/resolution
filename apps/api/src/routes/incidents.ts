import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { IncidentRepository, IncidentEvidenceRepository, RootCauseAnalysisRepository, parseJsonField } from "@resolution/database";
import type { OrganizationRepository } from "@resolution/database";
import { canTransition } from "@resolution/agents";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError, ConflictError } from "../lib/errors";
import type { AppEnv } from "../types";
import type { IncidentInvestigationQueue } from "../queue/types";

/**
 * `/investigate` is a manual trigger for Phase 7's agent — the primary path is automatic
 * (webhook ingestion enqueues it, see queue/consumer.ts's `onIncidentCreated`); this exists
 * for re-running investigation after an ESCALATED/FAILED outcome, which the state machine
 * already allows (incident-state-machine.ts) but nothing auto-retries. `/approve`, `/reject`,
 * `/remediate` land with Phase 8.
 */
export function buildIncidentRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
  investigationQueue: IncidentInvestigationQueue;
}): Hono<AppEnv> {
  const { db, env, organizationRepository, investigationQueue } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);

  router.get("/", auth, tenantContext, async (c) => {
    const incidents = new IncidentRepository(db, c.get("organizationId")!);
    const list = await incidents.list();
    return c.json({ incidents: list });
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

    return c.json({ incident, evidence, rca, events });
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

  return router;
}
