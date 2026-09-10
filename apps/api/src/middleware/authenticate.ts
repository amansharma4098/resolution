import type { FastifyReply, FastifyRequest } from "fastify";
import { sessionCookieName, verifySession } from "@resolution/security";
import { UnauthorizedError } from "../lib/errors";

/**
 * Verifies the session cookie and sets request.userId. This is identity only — it does
 * NOT establish which organization the request is scoped to; see tenant-context.ts for
 * that. Register as a preHandler on any route that requires a signed-in user.
 */
export function authenticate(jwtSecret: string) {
  return async function authenticatePreHandler(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const token = request.cookies[sessionCookieName()];
    if (!token) {
      throw new UnauthorizedError();
    }
    const payload = verifySession(token, jwtSecret);
    if (!payload) {
      throw new UnauthorizedError("Session is invalid or expired");
    }
    request.userId = payload.sub;
  };
}
