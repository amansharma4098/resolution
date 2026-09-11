import type { MiddlewareHandler } from "hono";
import { UserRepository, type PrismaClient } from "@resolution/database";
import { ForbiddenError } from "@resolution/security";
import { UnauthorizedError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * The platform-level gate for the Super Admin surface (apps/api/src/routes/platform.ts) —
 * deliberately separate from resolveTenantContext/requireMinimumRole (tenant-context.ts),
 * which answer "what's this user's role *within one org*". Super Admin is orthogonal to
 * that: the product owner/operator, not a member of any particular tenant. Run directly
 * after `authenticate` — no tenant context is needed or expected on these routes.
 */
export function requireSuperAdmin(db: PrismaClient): MiddlewareHandler<AppEnv> {
  const users = new UserRepository(db);
  return async (c, next) => {
    const userId = c.get("userId");
    if (!userId) throw new UnauthorizedError();
    const user = await users.findById(userId);
    if (!user?.isSuperAdmin) {
      throw new ForbiddenError("This action requires platform Super Admin access");
    }
    c.set("isSuperAdmin", true);
    await next();
  };
}
