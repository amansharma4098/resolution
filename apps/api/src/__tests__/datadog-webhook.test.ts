import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

function datadogPayload(overrides: Record<string, unknown> = {}) {
  return {
    alert_id: "999",
    alert_transition: "Triggered",
    alert_title: "[Triggered] High CPU on checkout-api",
    alert_query: "avg(last_5m):avg:system.cpu.user{service:checkout} > 90",
    event_msg: "CPU has been above 90% for 5 minutes",
    priority: "P2",
    host: "checkout-api-7f9",
    tags: "env:prod,service:checkout",
    link: "https://app.datadoghq.com/monitors/1",
    ...overrides,
  };
}

describe("Datadog webhook (auto-alerting)", () => {
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
      body: { type: "DATADOG", name: "Datadog monitors" },
    });
    const body = await jsonOf(created);
    integrationId = body.integration.id;
    secret = body.integration.config.webhookSecret;
    expect(body.webhookUrl).toMatch(new RegExp(`/api/webhooks/datadog/${integrationId}$`));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a request with a missing/wrong secret", async () => {
    const res = await app.request(`/api/webhooks/datadog/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "wrong" },
      body: JSON.stringify(datadogPayload()),
    });
    expect(res.status).toBe(404);
  });

  it("400s for a payload missing the required fields", async () => {
    const res = await app.request(`/api/webhooks/datadog/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify({ alert_title: "no alert_id or transition" }),
    });
    expect(res.status).toBe(400);
  });

  it("a Triggered alert creates an incident", async () => {
    const res = await app.request(`/api/webhooks/datadog/${integrationId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(datadogPayload()),
    });
    expect(res.status).toBe(202);

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    const incidents = (await jsonOf(list)).incidents;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      externalId: "999",
      source: "DATADOG",
      title: "[Triggered] High CPU on checkout-api",
      severity: "HIGH",
      priority: "P2",
      status: "NEW",
      service: "checkout",
    });
  });

  it("a Recovered transition for the same alert never creates an incident, and doesn't duplicate the Triggered one", async () => {
    const send = (overrides: Record<string, unknown>) =>
      app.request(`/api/webhooks/datadog/${integrationId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": secret },
        body: JSON.stringify(datadogPayload(overrides)),
      });
    await send({ alert_transition: "Triggered" });
    await send({ alert_transition: "Recovered", event_msg: "CPU back to normal" });

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(1);
  });

  it("is idempotent — replaying the exact same Triggered payload doesn't create a duplicate", async () => {
    const send = () =>
      app.request(`/api/webhooks/datadog/${integrationId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": secret },
        body: JSON.stringify(datadogPayload()),
      });
    await send();
    await send();

    const list = await req(app, "/api/incidents", { cookie, organizationId });
    expect((await jsonOf(list)).incidents).toHaveLength(1);
  });

  it("/test reports DISCONNECTED with a real reason when the credential is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
    const credential = await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      organizationId,
      body: {
        name: "Datadog keys",
        provider: "datadog",
        authenticationType: "CUSTOM",
        payload: { apiKey: "bad", applicationKey: "bad" },
      },
    });
    const credentialId = (await jsonOf(credential)).credential.id;
    await req(app, `/api/integrations/${integrationId}`, { method: "DELETE", cookie, organizationId });
    const created = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "DATADOG", name: "Datadog monitors", credentialId, config: { site: "datadoghq.com" } },
    });
    const id = (await jsonOf(created)).integration.id;

    const tested = await req(app, `/api/integrations/${id}/test`, { method: "POST", cookie, organizationId });
    expect(tested.status).toBe(200);
    const body = await jsonOf(tested);
    expect(body.integration.status).toBe("DISCONNECTED");
    expect(body.detail).toBeTruthy();
  });
});
