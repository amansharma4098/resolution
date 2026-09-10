import jwt from "jsonwebtoken";

/**
 * The session JWT carries identity only (`sub` = userId) — never a role or organizationId.
 * Membership can change (role edited, removed from an org) at any time, and a long-lived
 * token claim would go stale; apps/api's tenant-context middleware re-resolves
 * OrganizationMember fresh from the database on every request instead of trusting a claim.
 * This is what ARCHITECTURE.md §8 means by "tenant context is always derived from the
 * authenticated session, never trusted from the client" — the session proves *who*, the
 * database says *what they're allowed to touch, right now*.
 */
export interface SessionPayload {
  sub: string; // userId
}

const SESSION_COOKIE_NAME = "resolution_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function signSession(payload: SessionPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "string" || !decoded.sub) return null;
    return { sub: decoded.sub as string };
  } catch {
    return null;
  }
}

export function sessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

/** `secure` must be true in any non-local environment — cookies over plain HTTP leak the
 *  session token to anyone on the network path. */
export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
