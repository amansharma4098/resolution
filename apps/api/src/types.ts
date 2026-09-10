import "fastify";
import type { Role } from "@resolution/security";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the `authenticate` preHandler once the session cookie is verified. */
    userId?: string;
    /** Set by the `resolveTenantContext` preHandler once membership is confirmed for the
     *  X-Organization-Id header — never read organizationId from anywhere else. */
    organizationId?: string;
    role?: Role;
  }
}
