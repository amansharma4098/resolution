import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@resolution/database";
import { EncryptedDbSecretProvider } from "@resolution/credentials";
import { randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { loadEnv } from "../env";
import { createFakeDb } from "./fake-db";

export const testEnv = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused/test",
  JWT_SECRET: "test-secret-at-least-32-characters-long",
  CORS_ORIGIN: "http://localhost:3000",
  MOCK_MODE: "true",
});

/** Real envelope encryption (not a fake) with a fresh random key per test app instance —
 *  exercises packages/credentials end to end through the HTTP layer, not just its own
 *  unit tests. */
export async function buildTestApp(): Promise<{
  app: FastifyInstance;
  db: ReturnType<typeof createFakeDb>;
}> {
  const db = createFakeDb();
  const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
  const app = await buildApp({ db: db as unknown as PrismaClient, env: testEnv, secretProvider });
  return { app, db };
}

export function cookieFrom(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw!.split(";")[0]!;
}

export function parseCookie(raw: string): Record<string, string> {
  const [name, value] = raw.split("=");
  return { [name!]: decodeURIComponent(value!) };
}

/** Signs up a fresh user, creates an organization, and returns everything a route test
 *  needs: the session cookie jar and the X-Organization-Id header value. */
export async function signupWithOrg(
  app: FastifyInstance,
  email: string,
  orgName: string,
): Promise<{ cookies: Record<string, string>; organizationId: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { email, password: "correct horse battery staple" },
  });
  const cookies = parseCookie(cookieFrom(signup.headers["set-cookie"]));

  const org = await app.inject({
    method: "POST",
    url: "/api/organizations",
    cookies,
    payload: { name: orgName },
  });
  return { cookies, organizationId: org.json().organization.id };
}
