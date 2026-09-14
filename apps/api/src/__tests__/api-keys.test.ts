import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, cookieFrom, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("api key routes", () => {
  let app: Hono<AppEnv>;
  let cookie: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("creates a key, returning the raw token exactly once", async () => {
    const res = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "My laptop" } });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.token).toMatch(/^rsk_[0-9a-f]{64}$/);
    expect(body.apiKey.name).toBe("My laptop");
    expect(body.apiKey).not.toHaveProperty("keyHash");
    expect(body.apiKey).not.toHaveProperty("token");
  });

  it("lists a user's own keys without ever returning the raw token again", async () => {
    await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Key one" } });
    await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Key two" } });

    const res = await req(app, "/api/api-keys", { cookie });
    const body = await jsonOf(res);
    expect(body.apiKeys).toHaveLength(2);
    expect(body.apiKeys.every((k: Record<string, unknown>) => !("token" in k) && !("keyHash" in k))).toBe(true);
  });

  it("revokes a key, after which it's gone from the list", async () => {
    const created = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Key one" } });
    const id = (await jsonOf(created)).apiKey.id;

    const revoked = await req(app, `/api/api-keys/${id}`, { method: "DELETE", cookie });
    expect(revoked.status).toBe(204);

    const list = await jsonOf(await req(app, "/api/api-keys", { cookie }));
    expect(list.apiKeys.find((k: { id: string }) => k.id === id).revokedAt).not.toBeNull();
  });

  it("404s revoking another user's key", async () => {
    const created = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Owner's key" } });
    const id = (await jsonOf(created)).apiKey.id;

    const { app: sharedApp } = { app }; // same app instance, different user's cookie
    const otherSignup = await req(sharedApp, "/api/auth/signup", {
      method: "POST",
      body: { email: "intruder@example.com", password: "correct horse battery staple" },
    });
    const otherCookie = cookieFrom(otherSignup);

    const res = await req(app, `/api/api-keys/${id}`, { method: "DELETE", cookie: otherCookie });
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await req(app, "/api/api-keys");
    expect(res.status).toBe(401);
  });
});
