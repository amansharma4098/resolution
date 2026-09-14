import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

function genericPayload(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "ext-1",
    title: "Disk usage above 95%",
    description: "Root volume nearly full on host db-primary-1",
    severity: "HIGH",
    priority: "P2",
    service: "postgres",
    environment: "prod",
    ...overrides,
  };
}

describe("generic webhook connector", () => {
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
      body: { type: "WEBHOOK", name: "In-house monitor" },
    });
    const body = await jsonOf(created);
    integrationId = body.integration.id;
    secret = body.integration.config.webhookSecret;
    // Confirms the URL is exactly what an integrator would be told to point at.
    expect(body.webhookUrl).toMatch(new RegExp(`/api/webhooks/webhook/${integrationId}$`));
  });

  it("rejects a request with a missing/wrong secret the same way (404) as Jira/ServiceNow", async () => {
    const res = await app.request(`/api/webhooks/webhook/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "wrong" },
      body: JSON.stringify(genericPayload()),
    });
    expect(res.status).toBe(404);
  });

  it("400s synchronously for a payload that doesn't match the documented shape", async () => {
    const res = await app.request(`/api/webhooks/webhook/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify({ title: "no externalId" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.externalId).toBeDefined();
  });

  it("400s for invalid JSON", async () => {
    const res = await app.request(`/api/webhooks/webhook/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid payload (202) and creates the incident, defaults intact", async () => {
    const res = await app.request(`/api/webhooks/webhook/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(genericPayload()),
    });
    expect(res.status).toBe(202);
    expect((await jsonOf(res)).status).toBe("accepted");

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    const incidents = (await jsonOf(list)).incidents;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      externalId: "ext-1",
      source: "WEBHOOK",
      title: "Disk usage above 95%",
      severity: "HIGH",
      priority: "P2",
      service: "postgres",
      status: "NEW",
    });
  });

  it("is idempotent — replaying the exact same payload doesn't create a duplicate incident", async () => {
    const send = () =>
      app.request(`/api/webhooks/webhook/${integrationId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": secret },
        body: JSON.stringify(genericPayload()),
      });
    await send();
    await send();

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(1);
  });

  it("a second event with a different externalId creates a second incident", async () => {
    const send = (externalId: string) =>
      app.request(`/api/webhooks/webhook/${integrationId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": secret },
        body: JSON.stringify(genericPayload({ externalId })),
      });
    await send("ext-1");
    await send("ext-2");

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(2);
  });

  it("incidents from one org are invisible to another org", async () => {
    await app.request(`/api/webhooks/webhook/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(genericPayload()),
    });

    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const list = await req(app, "/api/incidents", { cookie: other.cookie, organizationId: other.organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(0);
  });

  it("defaults severity/priority/description/metadata when omitted", async () => {
    await app.request(`/api/webhooks/webhook/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify({ externalId: "ext-minimal", title: "Something happened" }),
    });

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents[0]).toMatchObject({
      severity: "MEDIUM",
      priority: "P3",
      description: "",
    });
  });

  it("/test reports there's nothing to test, rather than a misleading DISCONNECTED", async () => {
    const res = await req(app, `/api/integrations/${integrationId}/test`, {
      method: "POST",
      cookie,
      organizationId,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.integration.status).toBe("CONNECTED");
    expect(body.detail).toMatch(/[Nn]othing to test/);
  });
});
