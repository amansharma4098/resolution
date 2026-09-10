import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

function jiraPayload(overrides: Record<string, unknown> = {}) {
  return {
    webhookEvent: "jira:issue_created",
    issue: {
      id: "10002",
      key: "OPS-42",
      fields: {
        summary: "Nightly pipeline failing",
        description: "Timeout after 30 minutes",
        status: { name: "To Do" },
        priority: { name: "High" },
        project: { key: "OPS", name: "Operations" },
        created: "2026-01-01T00:00:00.000+0000",
        updated: "2026-01-01T00:00:00.000+0000",
      },
    },
    ...overrides,
  };
}

describe("jira webhook", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let organizationId: string;
  let integrationId: string;
  let secret: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));

    const created = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "JIRA", name: "Team Jira", config: { baseUrl: "https://acme.atlassian.net" } },
    });
    const body = await jsonOf(created);
    integrationId = body.integration.id;
    secret = body.integration.config.webhookSecret;
  });

  it("returns the webhook secret only once, at creation", async () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    const list = await req(app, "/api/integrations", { cookie, organizationId });
    const masked = (await jsonOf(list)).integrations[0].config.webhookSecret;
    expect(masked).not.toBe(secret);
    expect(masked).toMatch(/^••••/);
  });

  it("creates an incident from a valid webhook", async () => {
    const res = await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(jiraPayload()),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.status).toBe("created");

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    const incidents = (await jsonOf(list)).incidents;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      externalId: "OPS-42",
      source: "JIRA",
      title: "Nightly pipeline failing",
      severity: "HIGH",
      priority: "P2",
      status: "NEW",
    });
  });

  it("rejects a request with a wrong or missing secret", async () => {
    const wrongSecret = await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "wrong" },
      body: JSON.stringify(jiraPayload()),
    });
    expect(wrongSecret.status).toBe(404);

    const noSecret = await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(jiraPayload()),
    });
    expect(noSecret.status).toBe(404);
  });

  it("returns 404 for an unknown integrationId (never confirms existence)", async () => {
    const res = await app.request(`/api/webhooks/jira/00000000-0000-0000-0000-000000000000`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(jiraPayload()),
    });
    expect(res.status).toBe(404);
  });

  it("is idempotent — replaying the exact same payload doesn't create a duplicate incident", async () => {
    const payload = JSON.stringify(jiraPayload());
    await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: payload,
    });
    const second = await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: payload,
    });
    expect((await jsonOf(second)).status).toBe("already_processed");

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(1);
  });

  it("does not create a duplicate incident for an issue_updated event on the same issue", async () => {
    await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(jiraPayload({ webhookEvent: "jira:issue_created" })),
    });
    const updated = await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(
        jiraPayload({
          webhookEvent: "jira:issue_updated",
          issue: {
            id: "10002",
            key: "OPS-42",
            fields: {
              summary: "Nightly pipeline failing",
              status: { name: "In Progress" },
              priority: { name: "High" },
              project: { key: "OPS", name: "Operations" },
              created: "2026-01-01T00:00:00.000+0000",
              updated: "2026-01-01T00:05:00.000+0000",
            },
          },
        }),
      ),
    });
    expect((await jsonOf(updated)).status).toBe("already_ingested");

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(1);
  });

  it("ignores a webhook event it doesn't act on", async () => {
    const res = await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(jiraPayload({ webhookEvent: "jira:issue_deleted" })),
    });
    expect((await jsonOf(res)).status).toBe("ignored");
  });

  it("incidents from one org are invisible to another org", async () => {
    await app.request(`/api/webhooks/jira/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(jiraPayload()),
    });

    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const list = await req(app, "/api/incidents", { cookie: other.cookie, organizationId: other.organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(0);
  });
});
