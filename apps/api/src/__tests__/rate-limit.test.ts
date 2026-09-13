import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@resolution/database";
import { createRateLimitStore, rateLimit } from "../middleware/rate-limit";
import { buildApp } from "../app";
import { createFakeDb } from "./fake-db";
import { createCapturingEmailSender, req, testEnv } from "./test-helpers";

describe("rateLimit middleware", () => {
  it("allows up to `max` requests within the window, then 429s", async () => {
    const store = createRateLimitStore();
    const { Hono } = await import("hono");
    const app = new Hono();
    app.use("*", rateLimit(store, { max: 2, windowMs: 60_000 }));
    app.get("/x", (c) => c.text("ok"));

    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(429);
  });

  it("tracks separate IPs independently", async () => {
    const store = createRateLimitStore();
    const { Hono } = await import("hono");
    const app = new Hono();
    app.use("*", rateLimit(store, { max: 1, windowMs: 60_000 }));
    app.get("/x", (c) => c.text("ok"));

    const a = await app.request("/x", { headers: { "cf-connecting-ip": "1.1.1.1" } });
    const b = await app.request("/x", { headers: { "cf-connecting-ip": "2.2.2.2" } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const aAgain = await app.request("/x", { headers: { "cf-connecting-ip": "1.1.1.1" } });
    expect(aAgain.status).toBe(429);
  });

  it("shares one store across requests when the same store is reused (worker.ts's pattern), and isolates when it isn't", async () => {
    const sharedStore = createRateLimitStore();
    const db = createFakeDb() as unknown as PrismaClient;
    const emailSender = createCapturingEmailSender();

    // Two "requests" against apps built with the same shared login store, the way
    // worker.ts's module-scope stores persist across the many requests one Worker isolate
    // serves — a login attempt on the second app still counts against the first's budget.
    const appA = buildApp({
      db,
      env: testEnv,
      emailSender,
      rateLimitStores: {
        global: createRateLimitStore(),
        login: sharedStore,
        signup: createRateLimitStore(),
        forgotPassword: createRateLimitStore(),
      },
    });
    const appB = buildApp({
      db,
      env: testEnv,
      emailSender,
      rateLimitStores: {
        global: createRateLimitStore(),
        login: sharedStore,
        signup: createRateLimitStore(),
        forgotPassword: createRateLimitStore(),
      },
    });

    const attempt = () =>
      req(appA, "/api/auth/login", { method: "POST", body: { email: "x@example.com", password: "wrong" } });
    const attemptOnB = () =>
      req(appB, "/api/auth/login", { method: "POST", body: { email: "x@example.com", password: "wrong" } });

    for (let i = 0; i < 10; i++) {
      expect((await attempt()).status).toBe(401);
    }
    // The 11th attempt, even against a different app instance, hits the same shared store.
    expect((await attemptOnB()).status).toBe(429);
  });
});
