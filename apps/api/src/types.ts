import type { Role } from "@resolution/security";

/**
 * Hono's per-request context variables — the equivalent of the FastifyRequest
 * decorations from the Fastify version of this app. Set only by middleware
 * (authenticate/resolveTenantContext), never trusted from anything client-supplied.
 */
export interface Variables {
  requestId: string;
  userId?: string;
  /** Set only by authenticateApiKey — identifies which key authenticated this request, for
   *  audit logging. Never set by the session-cookie authenticate(). */
  apiKeyId?: string;
  tenantId?: string;
  role?: Role;
  /** Set only by requireSuperAdmin — platform-level, not tenant-scoped. Never set by
   *  resolveTenantContext, and never inferred from `role` (a tenant's OWNER is not
   *  automatically a Super Admin — the two are orthogonal). */
  isSuperAdmin?: boolean;
}

export type AppEnv = { Variables: Variables };
