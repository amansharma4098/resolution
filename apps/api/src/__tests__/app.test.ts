import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, cookieFrom, jsonOf, req } from "./test-helpers";
import type { AppEnv } from "../types";

describe("auth routes", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    ({ app } = buildTestApp());
  });

  it("signs up, sets a session cookie, and never returns the password hash", async () => {
    const res = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "alice@example.com", password: "correct horse battery staple" },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.passwordHash).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("rejects a weak password", async () => {
    const res = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "weak@example.com", password: "short" },
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects signup with a duplicate email", async () => {
    await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "dup@example.com", password: "correct horse battery staple" },
    });
    const res = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "dup@example.com", password: "another long password" },
    });
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials and rejects incorrect ones", async () => {
    await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "bob@example.com", password: "correct horse battery staple" },
    });

    const wrong = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "bob@example.com", password: "totally wrong password" },
    });
    expect(wrong.status).toBe(401);

    const right = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "bob@example.com", password: "correct horse battery staple" },
    });
    expect(right.status).toBe(200);
  });

  it("rejects login for a nonexistent user with the same error as a wrong password", async () => {
    const res = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "nobody@example.com", password: "whatever password here" },
    });
    expect(res.status).toBe(401);
    expect((await jsonOf(res)).error.message).toBe("Invalid email or password");
  });

  it("rejects /me without a session", async () => {
    const res = await req(app, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user for a valid session", async () => {
    const signup = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "carol@example.com", password: "correct horse battery staple" },
    });
    const cookie = cookieFrom(signup);

    const res = await req(app, "/api/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).user.email).toBe("carol@example.com");
  });

  it("every response carries an x-request-id header", async () => {
    const res = await req(app, "/healthz");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("organization routes", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    ({ app } = buildTestApp());
  });

  async function signupAndGetCookie(email: string) {
    const res = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email, password: "correct horse battery staple" },
    });
    return cookieFrom(res);
  }

  it("rejects creating an organization without auth", async () => {
    const res = await req(app, "/api/organizations", { method: "POST", body: { name: "Acme Corp" } });
    expect(res.status).toBe(401);
  });

  it("creates an organization and makes the creator OWNER", async () => {
    const cookie = await signupAndGetCookie("owner@example.com");
    const res = await req(app, "/api/organizations", { method: "POST", cookie, body: { name: "Acme Corp" } });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.organization.slug).toBe("acme-corp");
    expect(body.organization.role).toBe("OWNER");
  });

  it("lists only organizations the user is a member of", async () => {
    const aliceCookie = await signupAndGetCookie("alice2@example.com");
    const bobCookie = await signupAndGetCookie("bob2@example.com");

    await req(app, "/api/organizations", { method: "POST", cookie: aliceCookie, body: { name: "Alice Org" } });
    await req(app, "/api/organizations", { method: "POST", cookie: bobCookie, body: { name: "Bob Org" } });

    const res = await req(app, "/api/organizations", { cookie: aliceCookie });
    const body = await jsonOf(res);
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].name).toBe("Alice Org");
  });

  it("returns 404 (never 403) for an org the user is not a member of", async () => {
    const aliceCookie = await signupAndGetCookie("alice3@example.com");
    const bobCookie = await signupAndGetCookie("bob3@example.com");

    const created = await req(app, "/api/organizations", {
      method: "POST",
      cookie: aliceCookie,
      body: { name: "Alice Private Org" },
    });
    const orgId = (await jsonOf(created)).organization.id;

    const res = await req(app, `/api/organizations/${orgId}`, { cookie: bobCookie });
    expect(res.status).toBe(404);
  });

  it("generates a unique slug when names collide", async () => {
    const cookie = await signupAndGetCookie("slugtest@example.com");
    const first = await req(app, "/api/organizations", { method: "POST", cookie, body: { name: "Acme" } });
    const second = await req(app, "/api/organizations", { method: "POST", cookie, body: { name: "Acme" } });
    expect((await jsonOf(first)).organization.slug).toBe("acme");
    expect((await jsonOf(second)).organization.slug).toBe("acme-2");
  });
});
