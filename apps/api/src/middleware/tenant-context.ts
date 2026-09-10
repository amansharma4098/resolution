import type { FastifyReply, FastifyRequest } from "fastify";
import type { OrganizationRepository } from "@resolution/database";
import { requireRole, type Role } from "@resolution/security";
import { NotFoundError, UnauthorizedError } from "../lib/errors";

const ORG_HEADER = "x-organization-id";

/**
 * The single point where a request's tenant context is established. Per ARCHITECTURE.md
 * §8, organizationId is NEVER trusted from a client-supplied body field or query param —
 * every org-scoped route reads it from this header, and this middleware re-checks
 * OrganizationMember on every request before setting request.organizationId. Must run
 * after `authenticate` (needs request.userId).
 *
 * A non-member gets 404, not 403 — membership in an org is not disclosed to non-members,
 * so an unauthorized request can't distinguish "org doesn't exist" from "you're not in it".
 */
export function resolveTenantContext(organizationRepository: OrganizationRepository) {
  return async function tenantContextPreHandler(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (!request.userId) {
      throw new UnauthorizedError();
    }
    const organizationId = request.headers[ORG_HEADER];
    if (!organizationId || typeof organizationId !== "string") {
      throw new NotFoundError(`Missing required ${ORG_HEADER} header`);
    }
    const membership = await organizationRepository.findMembership(
      request.userId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundError("Organization not found");
    }
    request.organizationId = organizationId;
    request.role = membership.role;
  };
}

/** Run after resolveTenantContext. Throws (via @resolution/security's ForbiddenError,
 *  mapped to 403 by the error handler) if the resolved role doesn't meet `minimumRole`. */
export function requireMinimumRole(minimumRole: Role) {
  return async function requireRolePreHandler(request: FastifyRequest): Promise<void> {
    if (!request.role) {
      throw new UnauthorizedError("Tenant context not resolved");
    }
    requireRole(request.role, minimumRole);
  };
}
