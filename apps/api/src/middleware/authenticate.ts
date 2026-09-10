import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { sessionCookieName, verifySession } from "@resolution/security";
import { UnauthorizedError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * Verifies the session cookie and sets c.set("userId", ...). This is identity only — it
 * does NOT establish which organization the request is scoped to; see tenant-context.ts
 * for that. Apply as middleware on any route that requires a signed-in user.
 */
export function authenticate(jwtSecret: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, sessionCookieName());
    if (!token) {
      throw new UnauthorizedError();
    }
    const payload = await verifySession(token, jwtSecret);
    if (!payload) {
      throw new UnauthorizedError("Session is invalid or expired");
    }
    c.set("userId", payload.sub);
    await next();
  };
}
