import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { EncryptedDbSecretProvider } from "@resolution/credentials";
import { buildApp } from "../app";
import { loadEnv } from "../env";
import { createFakeDb } from "./fake-db";
import { createInlineIngestionQueue } from "../queue/inline-queue";
import { createInlineInvestigationQueue } from "../queue/inline-investigation-queue";
import type { AppEnv } from "../types";

export const testEnv = loadEnv({
  NODE_ENV: "test",
  JWT_SECRET: "test-secret-at-least-32-characters-long",
  CORS_ORIGIN: "http://localhost:3000",
  MOCK_MODE: "true",
});

/** Real envelope encryption (not a fake) with a fresh random key per test app instance —
 *  exercises packages/credentials end to end through the HTTP layer, not just its own
 *  unit tests.
 *
 * `chainInvestigation: true` wires the inline ingestion queue to also run the (mock)
 * investigation agent synchronously right after ingestion, the same way production's real
 * Cloudflare Queues eventually do, just collapsed into one tick — see app.ts's comment on
 * why this isn't the default. Existing Phase 3-6 tests rely on a webhook's HTTP response
 * reflecting only ingestion (status "NEW", exactly one IncidentEvent); only opt in for tests
 * that actually exercise Phase 7. */
export function buildTestApp(
  options: { chainInvestigation?: boolean } = {},
): { app: Hono<AppEnv>; db: ReturnType<typeof createFakeDb> } {
  const db = createFakeDb();
  const prismaDb = db as unknown as PrismaClient;
  const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
  const investigationQueue = createInlineInvestigationQueue(prismaDb, { mockMode: true, secretProvider });
  const incidentIngestionQueue = options.chainInvestigation
    ? createInlineIngestionQueue(prismaDb, investigationQueue)
    : undefined;
  const app = buildApp({
    db: prismaDb,
    env: testEnv,
    secretProvider,
    incidentInvestigationQueue: investigationQueue,
    incidentIngestionQueue,
  });
  return { app, db };
}

/** Extracts just "name=value" from a Set-Cookie response header (drops attributes like
 *  Path/HttpOnly/SameSite) so it can be replayed as a request Cookie header. */
export function cookieFrom(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) throw new Error("Response had no Set-Cookie header");
  return raw.split(";")[0]!;
}

export interface TestRequestOptions {
  method?: string;
  cookie?: string;
  organizationId?: string;
  body?: unknown;
}

/** Hono's app.request() is the fetch-style equivalent of Fastify's `.inject()` — no real
 *  server/socket needed. This wrapper just fills in the headers our app cares about. */
export async function req(
  app: Hono<AppEnv>,
  path: string,
  options: TestRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  if (options.organizationId) headers["x-organization-id"] = options.organizationId;

  return app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

/** Response.json() is typed `Promise<unknown>` under @types/node's fetch types (stricter
 *  than DOM lib's `any`) — this is just a typed cast point for test assertions, not
 *  runtime validation (the routes' own Zod schemas are what actually validate shape). */
export async function jsonOf<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Signs up a fresh user, creates an organization, and returns everything a route test
 *  needs: the session cookie and the X-Organization-Id header value. */
export async function signupWithOrg(
  app: Hono<AppEnv>,
  email: string,
  orgName: string,
): Promise<{ cookie: string; organizationId: string }> {
  const signup = await req(app, "/api/auth/signup", {
    method: "POST",
    body: { email, password: "correct horse battery staple" },
  });
  const cookie = cookieFrom(signup);

  const org = await req(app, "/api/organizations", { method: "POST", cookie, body: { name: orgName } });
  const orgBody = (await org.json()) as { organization: { id: string } };
  return { cookie, organizationId: orgBody.organization.id };
}
