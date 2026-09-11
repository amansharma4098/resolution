import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { AutomationPolicyRepository, auditLogWriter, type OrganizationRepository } from "@resolution/database";
import { MapServerType, PolicyBehavior, ResolutionMode, RiskLevel } from "@resolution/shared";
import { writeAuditLog } from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";

const UpsertPolicyBody = z.object({
  mapServerType: MapServerType,
  capabilityKey: z.string().min(1),
  riskLevel: RiskLevel,
  behavior: PolicyBehavior,
  resolutionModeFloor: ResolutionMode.default("RECOMMEND"),
});

/**
 * Admin-managed AutomationPolicy CRUD — ARCHITECTURE.md §7. Every capability an org hasn't
 * explicitly configured here falls back to packages/agents/policy-engine.ts's
 * DEFAULT_POLICY (APPROVAL, floor RECOMMEND) rather than silently auto-executing.
 */
export function buildAutomationPolicyRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");

  router.get("/", auth, tenantContext, async (c) => {
    const policies = new AutomationPolicyRepository(db, c.get("organizationId")!);
    return c.json({ policies: await policies.list() });
  });

  router.put("/", auth, tenantContext, requireAdmin, async (c) => {
    const body = UpsertPolicyBody.parse(await c.req.json());
    const policies = new AutomationPolicyRepository(db, c.get("organizationId")!);
    const policy = await policies.upsert(body);

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "automation_policy.upserted",
      targetType: "AutomationPolicy",
      targetId: policy.id,
      requestId: c.get("requestId"),
      metadata: { mapServerType: policy.mapServerType, capabilityKey: policy.capabilityKey, behavior: policy.behavior },
    });

    return c.json({ policy });
  });

  router.delete("/:id", auth, tenantContext, requireAdmin, async (c) => {
    const policies = new AutomationPolicyRepository(db, c.get("organizationId")!);
    const deleted = await policies.delete(c.req.param("id"));
    if (!deleted) throw new NotFoundError("Automation policy not found");

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "automation_policy.deleted",
      targetType: "AutomationPolicy",
      targetId: c.req.param("id"),
      requestId: c.get("requestId"),
    });

    return c.body(null, 204);
  });

  return router;
}
