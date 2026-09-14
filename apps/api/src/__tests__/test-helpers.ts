import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import type { PrismaClient } from "@resolution/database";
import { EncryptedDbSecretProvider } from "@resolution/credentials";
import type { EmailMessage, EmailSender } from "@resolution/email";
import type { LlmClient, LlmTurnResult } from "@resolution/ai";
import { buildApp } from "../app";
import { loadEnv } from "../env";
import { createFakeDb } from "./fake-db";
import { createInlineIngestionQueue } from "../queue/inline-queue";
import { createInlineInvestigationQueue } from "../queue/inline-investigation-queue";
import { createInlineRemediationQueue } from "../queue/inline-remediation-queue";
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
 * investigation agent synchronously right after ingestion; `chainRemediation: true` does the
 * same one stage further (a successful RCA runs the remediation pipeline too) — both the
 * same way production's real Cloudflare Queues eventually do, just collapsed into one tick.
 * See app.ts's comment on why this isn't the default. Existing Phase 3-6 tests rely on a
 * webhook's HTTP response reflecting only ingestion (status "NEW", exactly one
 * IncidentEvent); only opt in for tests that actually exercise Phase 7/8. The bounded
 * verification retry loop's `sleep` is always a no-op here — tests never need to wait out
 * real backoff delays. */
export interface CapturingEmailSender extends EmailSender {
  /** Every message handed to `.send()` so far, in order — lets a test read the
   *  forgot-password reset link out of a "sent" email instead of reaching into the
   *  database for the raw token, the same way a real user only ever sees it in their inbox. */
  sent: EmailMessage[];
}

export function createCapturingEmailSender(): CapturingEmailSender {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/** A fake LlmClient that plays back a fixed sequence of turns, one per `.send()` call — lets
 *  a chat test script exactly what the model "decides" to do (e.g. call list_incidents,
 *  then respond with text) without depending on packages/ai's mock clients, which are each
 *  shaped around a different, specific tool-calling loop (see mock-chat-client.ts's header
 *  comment). Throws if `.send()` is called more times than scripted — a test relying on more
 *  turns than it planned for is a test bug, not something to silently paper over. */
export interface ScriptedLlmClient extends LlmClient {
  calls: Array<{ system: string; messages: unknown[] }>;
}

export function createScriptedLlmClient(turns: LlmTurnResult[]): ScriptedLlmClient {
  let i = 0;
  const calls: ScriptedLlmClient["calls"] = [];
  return {
    isMock: true,
    calls,
    async send({ system, messages }) {
      // A snapshot, not the live array — the caller keeps pushing onto the same `messages`
      // array after this call returns, so storing the reference itself would make every
      // entry in `calls` retroactively reflect the *final* state instead of what this
      // particular call actually saw.
      calls.push({ system, messages: [...messages] });
      if (i >= turns.length) {
        throw new Error(`ScriptedLlmClient: no turn scripted for call #${i + 1}`);
      }
      return turns[i++]!;
    },
  };
}

export function buildTestApp(
  options: { chainInvestigation?: boolean; chainRemediation?: boolean; chatLlmClient?: LlmClient } = {},
): { app: Hono<AppEnv>; db: ReturnType<typeof createFakeDb>; emailSender: CapturingEmailSender } {
  const db = createFakeDb();
  const prismaDb = db as unknown as PrismaClient;
  const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
  const remediationQueue = createInlineRemediationQueue(prismaDb, {
    mockMode: true,
    secretProvider,
    sleep: async () => {},
  });
  const investigationQueue = createInlineInvestigationQueue(prismaDb, {
    mockMode: true,
    secretProvider,
    onRcaCompleted: options.chainRemediation ? (evt) => remediationQueue.send(evt) : undefined,
  });
  const incidentIngestionQueue = options.chainInvestigation
    ? createInlineIngestionQueue(prismaDb, investigationQueue)
    : undefined;
  const emailSender = createCapturingEmailSender();
  const app = buildApp({
    db: prismaDb,
    env: testEnv,
    secretProvider,
    incidentInvestigationQueue: investigationQueue,
    incidentRemediationQueue: remediationQueue,
    incidentIngestionQueue,
    emailSender,
    chatLlmClient: options.chatLlmClient,
  });
  return { app, db, emailSender };
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
