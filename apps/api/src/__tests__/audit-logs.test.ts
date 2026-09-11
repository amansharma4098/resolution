import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("audit log routes", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("records an audit entry for org-scoped mutations and lists them most-recent-first", async () => {
    // signupWithOrg's organization-create call itself doesn't audit-log, but creating a
    // credential does — real, existing write paths from earlier phases.
    await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      organizationId,
      body: { name: "Cred 1", provider: "jira", authenticationType: "BASIC_AUTH", payload: { username: "a", password: "t" } },
    });
    await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      organizationId,
      body: { name: "Cred 2", provider: "jira", authenticationType: "BASIC_AUTH", payload: { username: "c", password: "t2" } },
    });

    const res = await req(app, "/api/audit-logs", { cookie, organizationId });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries[0].action).toBe("credential.created");
    // Most-recent-first: the second-created entry sorts ahead of the first.
    const times = body.entries.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("never leaks a secret into audit metadata", async () => {
    await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      organizationId,
      body: { name: "Cred", provider: "jira", authenticationType: "BASIC_AUTH", payload: { username: "a", password: "t" } },
    });
    const res = await req(app, "/api/audit-logs", { cookie, organizationId });
    const body = await jsonOf(res);
    const json = JSON.stringify(body);
    expect(json).not.toContain("encryptedData");
    expect(json).not.toContain('"payload"');
  });

  it("respects limit and paginates via before", async () => {
    for (let i = 0; i < 3; i++) {
      await req(app, "/api/credentials", {
        method: "POST",
        cookie,
        organizationId,
        body: { name: `Cred ${i}`, provider: "jira", authenticationType: "BASIC_AUTH", payload: { username: "a", password: "t" } },
      });
    }
    const firstPage = await req(app, "/api/audit-logs?limit=2", { cookie, organizationId });
    const firstBody = await jsonOf(firstPage);
    expect(firstBody.entries).toHaveLength(2);
    expect(firstBody.nextBefore).toBeTruthy();

    const secondPage = await req(app, `/api/audit-logs?limit=2&before=${encodeURIComponent(firstBody.nextBefore)}`, {
      cookie,
      organizationId,
    });
    const secondBody = await jsonOf(secondPage);
    const firstIds = new Set(firstBody.entries.map((e: { id: string }) => e.id));
    for (const entry of secondBody.entries) {
      expect(firstIds.has(entry.id)).toBe(false);
    }
  });

  it("isolates audit logs per organization", async () => {
    await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      organizationId,
      body: { name: "Cred", provider: "jira", authenticationType: "BASIC_AUTH", payload: { username: "a", password: "t" } },
    });
    // A fresh org has its own audit trail (e.g. the owner's membership) but must never see
    // an action that happened in a different organization.
    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const res = await req(app, "/api/audit-logs", { cookie: other.cookie, organizationId: other.organizationId });
    const actions = (await jsonOf(res)).entries.map((e: { action: string }) => e.action);
    expect(actions).not.toContain("credential.created");
  });
});
