import { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { IncidentRepository } from "@resolution/database";
import type { OrganizationRepository } from "@resolution/database";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * Read-only for now — incidents are created by webhook ingestion (routes/webhooks.ts).
 * The full lifecycle (/investigate, /remediate, /approve, /reject from the spec's API
 * surface) lands with Phase 6 (state machine) through Phase 8 (remediation); this exists
 * now because Phase 3 already produces real Incident rows worth being able to see.
 */
export function buildIncidentRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
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
    return c.json({ incident });
  });

  return router;
}
