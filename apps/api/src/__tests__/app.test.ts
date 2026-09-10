import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@resolution/database";
import { buildApp } from "../app";
import { loadEnv } from "../env";
import { createFakeDb } from "./fake-db";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused/test",
  JWT_SECRET: "test-secret-at-least-32-characters-long",
  CORS_ORIGIN: "http://localhost:3000",
  MOCK_MODE: "true",
});

async function buildTestApp(): Promise<{ app: FastifyInstance; db: ReturnType<typeof createFakeDb> }> {
  const db = createFakeDb();
  const app = await buildApp({ db: db as unknown as PrismaClient, env });
  return { app, db };
}

function cookieFrom(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw!.split(";")[0]!;
}

describe("auth routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
  });

  it("signs up, sets a session cookie, and never returns the password hash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "alice@example.com", password: "correct horse battery staple" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a weak password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "weak@example.com", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects signup with a duplicate email", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "dup@example.com", password: "correct horse battery staple" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "dup@example.com", password: "another long password" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("logs in with correct credentials and rejects incorrect ones", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "bob@example.com", password: "correct horse battery staple" },
    });

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "bob@example.com", password: "totally wrong password" },
    });
    expect(wrong.statusCode).toBe(401);

    const right = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "bob@example.com", password: "correct horse battery staple" },
    });
    expect(right.statusCode).toBe(200);
  });

  it("rejects login for a nonexistent user with the same error as a wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "whatever password here" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Invalid email or password");
  });

  it("rejects /me without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the current user for a valid session", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "carol@example.com", password: "correct horse battery staple" },
    });
    const cookie = cookieFrom(signup.headers["set-cookie"]);

    const res = await app.inject({ method: "GET", url: "/api/auth/me", cookies: parseCookie(cookie) });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("carol@example.com");
  });

  it("every response carries an x-request-id header", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

describe("organization routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
  });

  async function signupAndGetCookie(email: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct horse battery staple" },
    });
    return parseCookie(cookieFrom(res.headers["set-cookie"]));
  }

  it("rejects creating an organization without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: { name: "Acme Corp" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates an organization and makes the creator OWNER", async () => {
    const cookies = await signupAndGetCookie("owner@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/organizations",
      cookies,
      payload: { name: "Acme Corp" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.organization.slug).toBe("acme-corp");
    expect(body.organization.role).toBe("OWNER");
  });

  it("lists only organizations the user is a member of", async () => {
    const aliceCookies = await signupAndGetCookie("alice2@example.com");
    const bobCookies = await signupAndGetCookie("bob2@example.com");

    await app.inject({
      method: "POST",
      url: "/api/organizations",
      cookies: aliceCookies,
      payload: { name: "Alice Org" },
    });
    await app.inject({
      method: "POST",
      url: "/api/organizations",
      cookies: bobCookies,
      payload: { name: "Bob Org" },
    });

    const res = await app.inject({ method: "GET", url: "/api/organizations", cookies: aliceCookies });
    const body = res.json();
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].name).toBe("Alice Org");
  });

  it("returns 404 (never 403) for an org the user is not a member of", async () => {
    const aliceCookies = await signupAndGetCookie("alice3@example.com");
    const bobCookies = await signupAndGetCookie("bob3@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/api/organizations",
      cookies: aliceCookies,
      payload: { name: "Alice Private Org" },
    });
    const orgId = created.json().organization.id;

    const res = await app.inject({
      method: "GET",
      url: `/api/organizations/${orgId}`,
      cookies: bobCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it("generates a unique slug when names collide", async () => {
    const cookies = await signupAndGetCookie("slugtest@example.com");
    const first = await app.inject({
      method: "POST",
      url: "/api/organizations",
      cookies,
      payload: { name: "Acme" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/organizations",
      cookies,
      payload: { name: "Acme" },
    });
    expect(first.json().organization.slug).toBe("acme");
    expect(second.json().organization.slug).toBe("acme-2");
  });
});

/** Turns a raw "name=value" Set-Cookie fragment into fastify.inject()'s cookies map. */
function parseCookie(raw: string): Record<string, string> {
  const [name, value] = raw.split("=");
  return { [name!]: decodeURIComponent(value!) };
}
