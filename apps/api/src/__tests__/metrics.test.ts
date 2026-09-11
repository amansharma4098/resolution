import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Hono } from "hono";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { FakeDb } from "./fake-db";
import type { AppEnv } from "../types";

const k8sProvider: MapServerProvider = {
  type: "KUBERNETES",
  metadata: { displayName: "Kubernetes (fixture)", isMock: true },
  configSchema: z.object({}),
  authAdapter: { authenticationTypes: ["TOKEN"], testConnection: async () => ({ status: "CONNECTED" }) },
  capabilities: [
    {
      key: "restart_pod",
      description: "Restart a crashing pod",
      riskLevel: "MEDIUM",
      mutating: true,
      inputSchema: z.object({ podName: z.string().min(1) }),
      outputSchema: z.object({ restarted: z.boolean() }),
      execute: async () => ({ restarted: true }),
    },
  ],
  healthCheck: async () => ({ status: "CONNECTED" }),
};

function jiraPayload(key: string) {
  return {
    webhookEvent: "jira:issue_created",
    issue: {
      id: key,
      key,
      fields: {
        summary: "Nightly job failing",
        description: "Job run failed",
        status: { name: "To Do" },
        priority: { name: "High" },
        project: { key: "OPS", name: "Operations" },
        created: "2026-01-01T00:00:00.000+0000",
        updated: "2026-01-01T00:00:00.000+0000",
      },
    },
  };
}

describe("metrics routes", () => {
  let app: Hono<AppEnv>;
  let db: FakeDb;
  let cookie: string;
  let organizationId: string;

  afterEach(() => {
    __resetRegistryForTests();
  });

  beforeEach(async () => {
    ({ app, db } = buildTestApp({ chainInvestigation: true, chainRemediation: true }));
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("starts at zero for a fresh org", async () => {
    const res = await req(app, "/api/metrics", { cookie, organizationId });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.incidents.total).toBe(0);
    expect(body.incidents.avgResolutionTimeMs).toBeNull();
    expect(body.remediation.proposed).toBe(0);
  });

  it("counts incidents by status and tallies a full AUTO remediation end to end", async () => {
    registerMapServer(k8sProvider);
    await req(app, `/api/organizations/${organizationId}`, {
      method: "PATCH",
      cookie,
      body: { resolutionMode: "AUTONOMOUS" },
    });
    const integ = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
    });
    const integration = (await jsonOf(integ)).integration;
    const msRes = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "KUBERNETES", name: "Prod K8s", environments: ["prod"], config: {} },
    });
    const mapServer = (await jsonOf(msRes)).mapServer;
    await req(app, `/api/map-servers/${mapServer.id}/capabilities/restart_pod`, {
      method: "PATCH",
      cookie,
      organizationId,
      body: { enabled: true },
    });
    await req(app, "/api/automation-policies", {
      method: "PUT",
      cookie,
      organizationId,
      body: {
        mapServerType: "KUBERNETES",
        capabilityKey: "restart_pod",
        riskLevel: "MEDIUM",
        behavior: "AUTO",
        resolutionModeFloor: "AUTONOMOUS",
      },
    });

    await app.request(`/api/webhooks/jira/${integration.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
      body: JSON.stringify(jiraPayload("OPS-1")),
    });

    const incident = db._debug.incidents[0]!;
    expect(incident.status).toBe("RESOLVED");
    expect(incident.resolvedAt).not.toBeNull();

    const res = await req(app, "/api/metrics", { cookie, organizationId });
    const body = await jsonOf(res);
    expect(body.incidents.total).toBe(1);
    expect(body.incidents.byStatus.RESOLVED).toBe(1);
    expect(body.incidents.open).toBe(0);
    expect(typeof body.incidents.avgResolutionTimeMs).toBe("number");
    expect(body.remediation.proposed).toBe(1);
    expect(body.remediation.succeeded).toBe(1);
  });

  it("isolates metrics per organization", async () => {
    registerMapServer(k8sProvider);
    const integ = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
    });
    const integration = (await jsonOf(integ)).integration;
    await app.request(`/api/webhooks/jira/${integration.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
      body: JSON.stringify(jiraPayload("OPS-2")),
    });

    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const res = await req(app, "/api/metrics", { cookie: other.cookie, organizationId: other.organizationId });
    expect((await jsonOf(res)).incidents.total).toBe(0);
  });
});
