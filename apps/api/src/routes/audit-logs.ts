import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { AuditLogRepository } from "@resolution/database";
import type { OrganizationRepository } from "@resolution/database";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { resolveTenantContext } from "../middleware/tenant-context";
import type { AppEnv } from "../types";

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

/** Read-only — ARCHITECTURE.md §11: an audit entry on every AI tool call and every
 *  user-initiated mutating action, viewable by any member (not just admins — knowing what
 *  happened to your org's incidents isn't privileged the way changing policy is). */
export function buildAuditLogRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);

  router.get("/", auth, tenantContext, async (c) => {
    const query = ListQuery.parse({
      limit: c.req.query("limit"),
      before: c.req.query("before"),
    });
    const auditLogs = new AuditLogRepository(db, c.get("organizationId")!);
    const entries = await auditLogs.list(query);
    const nextBefore = entries.length === query.limit ? entries[entries.length - 1]!.createdAt : null;
    return c.json({ entries, nextBefore });
  });

  return router;
}
