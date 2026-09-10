import type { MiddlewareHandler } from "hono";
import type { OrganizationRepository } from "@resolution/database";
import { requireRole, type Role } from "@resolution/security";
import { NotFoundError, UnauthorizedError } from "../lib/errors";
import type { AppEnv } from "../types";

const ORG_HEADER = "x-organization-id";

/**
 * The single point where a request's tenant context is established. Per ARCHITECTURE.md
 * §8, organizationId is NEVER trusted from a client-supplied body field or query param —
 * every org-scoped route reads it from this header, and this middleware re-checks
 * OrganizationMember on every request before setting c.set("organizationId", ...). Must
 * run after `authenticate` (needs c.get("userId")).
 *
 * A non-member gets 404, not 403 — membership in an org is not disclosed to non-members,
 * so an unauthorized request can't distinguish "org doesn't exist" from "you're not in it".
 */
export function resolveTenantContext(
  organizationRepository: OrganizationRepository,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new UnauthorizedError();
    }
    const organizationId = c.req.header(ORG_HEADER);
    if (!organizationId) {
      throw new NotFoundError(`Missing required ${ORG_HEADER} header`);
    }
    const membership = await organizationRepository.findMembership(userId, organizationId);
    if (!membership) {
      throw new NotFoundError("Organization not found");
    }
    c.set("organizationId", organizationId);
    c.set("role", membership.role);
    await next();
  };
}

/** Run after resolveTenantContext. Throws (via @resolution/security's ForbiddenError,
 *  mapped to 403 by the error handler) if the resolved role doesn't meet `minimumRole`. */
export function requireMinimumRole(minimumRole: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get("role");
    if (!role) {
      throw new UnauthorizedError("Tenant context not resolved");
    }
    requireRole(role, minimumRole);
    await next();
  };
}
