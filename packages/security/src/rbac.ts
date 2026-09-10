/**
 * RBAC. Role comes from OrganizationMember.role (packages/database/prisma/schema.prisma) —
 * never from a client-supplied field. apps/api's tenant-context middleware is the only
 * place that resolves a request's role, by looking up the authenticated user's membership
 * row for the organization in the URL/route, and every route handler that mutates
 * tenant-owned data calls requireRole() against that resolved role, not against anything
 * the client sent.
 */
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

// Higher number = more privilege. OWNER can do everything ADMIN can, and so on down.
const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** True if `role` meets or exceeds `minimumRole`. */
export function hasRole(role: Role, minimumRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/** Throws ForbiddenError if `role` does not meet `minimumRole`. Use at the top of any
 *  route handler that mutates org-scoped state. */
export function requireRole(role: Role, minimumRole: Role): void {
  if (!hasRole(role, minimumRole)) {
    throw new ForbiddenError(
      `This action requires the ${minimumRole} role or higher (you have ${role})`,
    );
  }
}
