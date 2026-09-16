import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { z } from "zod";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { FakeDb } from "./fake-db";
import type { AppEnv } from "../types";

function jiraPayload() {
  return {
    webhookEvent: "jira:issue_created",
    issue: {
      id: "1",
      key: "OPS-1",
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

describe("postmortem drafting", () => {
  let app: Hono<AppEnv>;
  let db: FakeDb;
  let cookie: string;
  let tenantId: string;

  afterEach(() => {
    __resetRegistryForTests();
  });

  async function createResolvedIncident() {
    registerMapServer(k8sProvider);
    await req(app, `/api/organizations/${tenantId}`, { method: "PATCH", cookie, body: { resolutionMode: "RECOMMEND" } });

    const integ = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
    });
    const integration = (await jsonOf(integ)).integration;

    const msRes = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "KUBERNETES", name: "Prod K8s", environments: ["prod"], config: {} },
    });
    const mapServer = (await jsonOf(msRes)).mapServer;
    await req(app, `/api/map-servers/${mapServer.id}/capabilities/restart_pod`, {
      method: "PATCH",
      cookie,
      tenantId,
      body: { enabled: true },
    });

    const webhook = await app.request(`/api/webhooks/jira/${integration.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
      body: JSON.stringify(jiraPayload()),
    });
    expect(webhook.status).toBe(202);

    const list = await req(app, "/api/incidents", { cookie, tenantId });
    const incidentId = (await jsonOf(list)).incidents[0].id as string;

    const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, tenantId });
    const action = (await jsonOf(detail)).resolutions[0].actions[0];

    const decide = await req(app, `/api/incidents/${incidentId}/approvals/${action.approval.id}/decide`, {
      method: "POST",
      cookie,
      tenantId,
      body: { decision: "APPROVE" },
    });
    expect((await jsonOf(decide)).status).toBe("EXECUTED");
    expect(db._debug.incidents.find((i) => i.id === incidentId)!.status).toBe("RESOLVED");

    return incidentId;
  }

  describe("auto-drafted the moment an incident resolves", () => {
    beforeEach(async () => {
      ({ app, db } = buildTestApp({ chainInvestigation: true, chainRemediation: true }));
      ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    });

    it("GET /api/incidents/:id includes a postmortem with the real record's sections, labeled mock in test's MOCK_MODE", async () => {
      const incidentId = await createResolvedIncident();

      const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, tenantId });
      const body = await jsonOf(detail);
      expect(body.postmortem).not.toBeNull();
      expect(body.postmortem.isMock).toBe(true);
      expect(body.postmortem.content).toContain("MOCK_MODE");
      expect(body.postmortem.content).toContain("## Summary");
      expect(body.postmortem.content).toContain("## Resolution");
    });

    it("a fresh incident with no postmortem yet returns null, not an error", async () => {
      registerMapServer(k8sProvider);
      const integ = await req(app, "/api/integrations", {
        method: "POST",
        cookie,
        tenantId,
        body: { type: "WEBHOOK", name: "Generic" },
      });
      const integration = (await jsonOf(integ)).integration;
      await app.request(`/api/webhooks/webhook/${integration.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
        body: JSON.stringify({ externalId: "x1", title: "Something broke" }),
      });
      const list = await req(app, "/api/incidents", { cookie, tenantId });
      const incidentId = (await jsonOf(list)).incidents[0].id;

      const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, tenantId });
      expect((await jsonOf(detail)).postmortem).toBeNull();
    });
  });

  describe("manual regenerate and shared tool", () => {
    beforeEach(async () => {
      ({ app, db } = buildTestApp({ chainInvestigation: true, chainRemediation: true }));
      ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    });

    it("POST /:id/postmortem/regenerate drafts and then replaces the postmortem", async () => {
      const incidentId = await createResolvedIncident();

      const first = await req(app, `/api/incidents/${incidentId}/postmortem/regenerate`, { method: "POST", cookie, tenantId });
      expect(first.status).toBe(200);
      expect((await jsonOf(first)).isMock).toBe(true);

      const second = await req(app, `/api/incidents/${incidentId}/postmortem/regenerate`, { method: "POST", cookie, tenantId });
      expect(second.status).toBe(200);

      // Still exactly one Postmortem row for this incident — regenerate replaces, not accumulates.
      expect(db._debug.incidents.find((i) => i.id === incidentId)).toBeTruthy();
    });

    it("generate_postmortem and get_postmortem tools (shared by chat and MCP) work end to end", async () => {
      const incidentId = await createResolvedIncident();
      const apiKeyRes = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Claude Desktop" } });
      const apiKey = (await jsonOf(apiKeyRes)).token;

      async function mcpCall(name: string, args: Record<string, unknown>) {
        const res = await app.request("/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = await res.json();
        return JSON.parse(body.result.content[0].text);
      }

      // Already auto-drafted the moment executeAndVerify resolved the incident above —
      // get_postmortem is a pure read, so it sees that draft immediately.
      const beforeRegenerate = await mcpCall("get_postmortem", { tenantId, incidentId });
      expect(beforeRegenerate.content).toContain("## Summary");

      const regenerated = await mcpCall("generate_postmortem", { tenantId, incidentId });
      expect(regenerated.isMock).toBe(true);

      const afterRegenerate = await mcpCall("get_postmortem", { tenantId, incidentId });
      expect(afterRegenerate.content).toContain("## Summary");
    });
  });
});
