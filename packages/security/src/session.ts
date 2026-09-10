import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * The session JWT carries identity only (`sub` = userId) — never a role or organizationId.
 * Membership can change (role edited, removed from an org) at any time, and a long-lived
 * token claim would go stale; apps/api's tenant-context middleware re-resolves
 * OrganizationMember fresh from the database on every request instead of trusting a claim.
 * This is what ARCHITECTURE.md §8 means by "tenant context is always derived from the
 * authenticated session, never trusted from the client" — the session proves *who*, the
 * database says *what they're allowed to touch, right now*.
 *
 * Built on `jose` rather than `jsonwebtoken` — jose is Web Crypto-based and runs natively
 * in Cloudflare Workers (ARCHITECTURE.md §2) as well as Node, with no compatibility flag.
 */
export interface SessionPayload {
  sub: string; // userId
}

const SESSION_COOKIE_NAME = "resolution_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ALG = "HS256";

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax" | "None";
  path: "/";
  maxAge: number;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  return new SignJWT({ sub: payload.sub } satisfies JWTPayload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: [ALG] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export function sessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

/**
 * `secure` must be true in any non-local environment — cookies over plain HTTP leak the
 * session token to anyone on the network path. It also decides SameSite: the deployed
 * frontend (Cloudflare Pages) and API (a Worker) are different sites (pages.dev vs
 * workers.dev), so a cross-site fetch needs `SameSite=None` — which browsers only honor
 * alongside `Secure`. Local dev (same-site-ish over plain http) uses `Lax`, since
 * `SameSite=None` without `Secure` is rejected outright by the browser.
 */
export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
