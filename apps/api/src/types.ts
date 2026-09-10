import type { Role } from "@resolution/security";

/**
 * Hono's per-request context variables — the equivalent of the FastifyRequest
 * decorations from the Fastify version of this app. Set only by middleware
 * (authenticate/resolveTenantContext), never trusted from anything client-supplied.
 */
export interface Variables {
  requestId: string;
  userId?: string;
  organizationId?: string;
  role?: Role;
}

export type AppEnv = { Variables: Variables };
