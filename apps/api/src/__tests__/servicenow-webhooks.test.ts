import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

function snowPayload(overrides: Record<string, unknown> = {}) {
  return {
    sys_id: "sys123",
    number: "INC0010099",
    short_description: "VPN gateway unreachable",
    description: "Site-to-site tunnel dropped at 02:14 UTC",
    priority: "1 - Critical",
    state: "1",
    category: "Network",
    ...overrides,
  };
}

describe("servicenow webhook", () => {
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
      body: { type: "SERVICENOW", name: "Corp ServiceNow", config: { baseUrl: "https://acme.service-now.com" } },
    });
    const body = await jsonOf(created);
    integrationId = body.integration.id;
    secret = body.integration.config.webhookSecret;
  });

  it("accepts the webhook immediately (202) and creates the incident off-queue", async () => {
    const res = await app.request(`/api/webhooks/servicenow/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(snowPayload()),
    });
    expect(res.status).toBe(202);

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    const incidents = (await jsonOf(list)).incidents;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      externalId: "INC0010099",
      source: "SERVICENOW",
      title: "VPN gateway unreachable",
      severity: "CRITICAL",
      priority: "P1",
    });
  });

  it("rejects a request with a wrong secret", async () => {
    const res = await app.request(`/api/webhooks/servicenow/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "wrong" },
      body: JSON.stringify(snowPayload()),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a payload missing required fields", async () => {
    const res = await app.request(`/api/webhooks/servicenow/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify({ sys_id: "sys123" }),
    });
    expect(res.status).toBe(400);
  });

  it("a JIRA-typed webhook URL cannot be used to inject a ServiceNow-shaped payload", async () => {
    const jiraIntegration = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
    });
    const jiraBody = await jsonOf(jiraIntegration);

    const res = await app.request(`/api/webhooks/servicenow/${jiraBody.integration.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": jiraBody.integration.config.webhookSecret },
      body: JSON.stringify(snowPayload()),
    });
    expect(res.status).toBe(404);
  });

  it("is idempotent", async () => {
    const payload = JSON.stringify(snowPayload());
    await app.request(`/api/webhooks/servicenow/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: payload,
    });
    const second = await app.request(`/api/webhooks/servicenow/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: payload,
    });
    expect(second.status).toBe(202);

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(1);
  });
});
