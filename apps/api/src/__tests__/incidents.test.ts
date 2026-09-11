import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { z } from "zod";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { FakeDb } from "./fake-db";
import type { AppEnv } from "../types";

const fixtureProvider: MapServerProvider = {
  type: "DATABRICKS",
  metadata: { displayName: "Databricks (fixture)", isMock: true },
  configSchema: z.object({}),
  authAdapter: { authenticationTypes: ["SERVICE_PRINCIPAL"], testConnection: async () => ({ status: "CONNECTED" }) },
  capabilities: [
    {
      key: "get_job_run",
      description: "Fetch a job run",
      riskLevel: "LOW",
      mutating: false,
      inputSchema: z.object({ runId: z.string() }),
      outputSchema: z.object({ status: z.string() }),
      execute: async () => ({ status: "FAILED" }),
    },
  ],
  healthCheck: async () => ({ status: "CONNECTED" }),
};

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

describe("incident routes — investigation (Phase 7)", () => {
  let app: Hono<AppEnv>;
  let db: FakeDb;
  let cookie: string;
  let organizationId: string;

  afterEach(() => {
    __resetRegistryForTests();
  });

  describe("a webhook chained straight through to investigation", () => {
    beforeEach(async () => {
      ({ app, db } = buildTestApp({ chainInvestigation: true }));
      ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    });

    it("ends up RCA_COMPLETE with evidence and a citation-honoring RCA, all visible via GET /:id", async () => {
      registerMapServer(fixtureProvider);
      const created = await req(app, "/api/integrations", {
        method: "POST",
        cookie,
        organizationId,
        body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
      });
      const integration = (await jsonOf(created)).integration;

      const msRes = await req(app, "/api/map-servers", {
        method: "POST",
        cookie,
        organizationId,
        body: { type: "DATABRICKS", name: "Prod Databricks", environments: ["prod"], config: {} },
      });
      const mapServer = (await jsonOf(msRes)).mapServer;
      await req(app, `/api/map-servers/${mapServer.id}/capabilities/get_job_run`, {
        method: "PATCH",
        cookie,
        organizationId,
        body: { enabled: true },
      });

      const webhook = await app.request(`/api/webhooks/jira/${integration.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
        body: JSON.stringify(jiraPayload()),
      });
      expect(webhook.status).toBe(202);

      const list = await req(app, "/api/incidents", { cookie, organizationId });
      const incidentSummary = (await jsonOf(list)).incidents[0];
      expect(incidentSummary.status).toBe("RCA_COMPLETE");

      const detail = await req(app, `/api/incidents/${incidentSummary.id}`, { cookie, organizationId });
      expect(detail.status).toBe(200);
      const body = await jsonOf(detail);

      expect(body.incident.status).toBe("RCA_COMPLETE");
      expect(body.evidence.length).toBeGreaterThan(0);
      expect(body.evidence[0]).toMatchObject({ source: mapServer.id, capabilityKey: "get_job_run" });
      expect(body.rca).toMatchObject({ incidentId: incidentSummary.id });
      expect(body.rca.claims.length).toBeGreaterThan(0);

      const eventTypes = body.events.map((e: { type: string }) => e.type);
      expect(eventTypes).toEqual(["ingested", "status_changed", "rca_completed"]);
    });
  });

  describe("POST /:id/investigate (manual trigger)", () => {
    beforeEach(async () => {
      // Not chained — investigation only ever runs when this route (or the automatic
      // ingestion hook, in production) enqueues it.
      ({ app, db } = buildTestApp());
      ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    });

    it("investigates a NEW incident on demand", async () => {
      const created = await req(app, "/api/integrations", {
        method: "POST",
        cookie,
        organizationId,
        body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
      });
      const integration = (await jsonOf(created)).integration;
      await app.request(`/api/webhooks/jira/${integration.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
        body: JSON.stringify(jiraPayload()),
      });
      const list = await req(app, "/api/incidents", { cookie, organizationId });
      const incidentId = (await jsonOf(list)).incidents[0].id;
      expect(db._debug.incidents.find((i) => i.id === incidentId)!.status).toBe("NEW");

      const res = await req(app, `/api/incidents/${incidentId}/investigate`, {
        method: "POST",
        cookie,
        organizationId,
      });
      expect(res.status).toBe(202);
      expect(db._debug.incidents.find((i) => i.id === incidentId)!.status).toBe("RCA_COMPLETE");
    });

    it("refuses to start a second investigation while one is already past NEW", async () => {
      const created = await req(app, "/api/integrations", {
        method: "POST",
        cookie,
        organizationId,
        body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
      });
      const integration = (await jsonOf(created)).integration;
      await app.request(`/api/webhooks/jira/${integration.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
        body: JSON.stringify(jiraPayload()),
      });
      const list = await req(app, "/api/incidents", { cookie, organizationId });
      const incidentId = (await jsonOf(list)).incidents[0].id;

      await req(app, `/api/incidents/${incidentId}/investigate`, { method: "POST", cookie, organizationId });
      const second = await req(app, `/api/incidents/${incidentId}/investigate`, {
        method: "POST",
        cookie,
        organizationId,
      });
      expect(second.status).toBe(409);
    });

    it("404s for an incident in another organization", async () => {
      const created = await req(app, "/api/integrations", {
        method: "POST",
        cookie,
        organizationId,
        body: { type: "JIRA", name: "Jira", config: { baseUrl: "https://acme.atlassian.net" } },
      });
      const integration = (await jsonOf(created)).integration;
      await app.request(`/api/webhooks/jira/${integration.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
        body: JSON.stringify(jiraPayload()),
      });
      const list = await req(app, "/api/incidents", { cookie, organizationId });
      const incidentId = (await jsonOf(list)).incidents[0].id;

      const other = await signupWithOrg(app, "other@example.com", "Other Org");
      const res = await req(app, `/api/incidents/${incidentId}/investigate`, {
        method: "POST",
        cookie: other.cookie,
        organizationId: other.organizationId,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("remediation approval flow (Phase 8)", () => {
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

    beforeEach(async () => {
      ({ app, db } = buildTestApp({ chainInvestigation: true, chainRemediation: true }));
      ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    });

    async function createEscalatableIncident() {
      registerMapServer(k8sProvider);
      // RECOMMEND (or above) — the default policy engine floor. Below RECOMMEND every
      // capability denies outright (see policy-engine.ts's DEFAULT_POLICY), so the proposal
      // above would never even reach an Approval row.
      await req(app, `/api/organizations/${organizationId}`, {
        method: "PATCH",
        cookie,
        body: { resolutionMode: "RECOMMEND" },
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

      const webhook = await app.request(`/api/webhooks/jira/${integration.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": integration.config.webhookSecret },
        body: JSON.stringify(jiraPayload()),
      });
      expect(webhook.status).toBe(202);

      const list = await req(app, "/api/incidents", { cookie, organizationId });
      return (await jsonOf(list)).incidents[0].id as string;
    }

    it("a proposed remediation under RECOMMEND mode lands PENDING_APPROVAL, and approving it executes and resolves", async () => {
      const incidentId = await createEscalatableIncident();
      expect(db._debug.incidents.find((i) => i.id === incidentId)!.status).toBe("PENDING_APPROVAL");

      const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, organizationId });
      const body = await jsonOf(detail);
      expect(body.resolutions).toHaveLength(1);
      const action = body.resolutions[0].actions[0];
      expect(action.approval.status).toBe("PENDING");

      const decide = await req(app, `/api/incidents/${incidentId}/approvals/${action.approval.id}/decide`, {
        method: "POST",
        cookie,
        organizationId,
        body: { decision: "APPROVE" },
      });
      expect(decide.status).toBe(200);
      expect((await jsonOf(decide)).status).toBe("EXECUTED");

      const finalIncident = db._debug.incidents.find((i) => i.id === incidentId)!;
      expect(finalIncident.status).toBe("RESOLVED");
      expect(db._debug.remediationActions.find((a) => a.id === action.id)!.status).toBe("SUCCEEDED");
    });

    it("rejecting an approval closes the incident and never executes the capability", async () => {
      const incidentId = await createEscalatableIncident();
      const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, organizationId });
      const action = (await jsonOf(detail)).resolutions[0].actions[0];

      const decide = await req(app, `/api/incidents/${incidentId}/approvals/${action.approval.id}/decide`, {
        method: "POST",
        cookie,
        organizationId,
        body: { decision: "REJECT", reason: "Too risky right now" },
      });
      expect(decide.status).toBe(200);
      expect((await jsonOf(decide)).status).toBe("REJECTED");

      expect(db._debug.incidents.find((i) => i.id === incidentId)!.status).toBe("CLOSED");
      expect(db._debug.remediationActions.find((a) => a.id === action.id)!.status).toBe("PENDING");
    });

    it("refuses to decide the same approval twice", async () => {
      const incidentId = await createEscalatableIncident();
      const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, organizationId });
      const action = (await jsonOf(detail)).resolutions[0].actions[0];

      await req(app, `/api/incidents/${incidentId}/approvals/${action.approval.id}/decide`, {
        method: "POST",
        cookie,
        organizationId,
        body: { decision: "APPROVE" },
      });
      const second = await req(app, `/api/incidents/${incidentId}/approvals/${action.approval.id}/decide`, {
        method: "POST",
        cookie,
        organizationId,
        body: { decision: "APPROVE" },
      });
      expect(second.status).toBe(409);
    });

    it("GET /approvals/pending lists it, and it disappears once decided", async () => {
      const incidentId = await createEscalatableIncident();

      const pending = await req(app, "/api/incidents/approvals/pending", { cookie, organizationId });
      expect(pending.status).toBe(200);
      const pendingBody = await jsonOf(pending);
      expect(pendingBody.pending).toHaveLength(1);
      expect(pendingBody.pending[0]).toMatchObject({ incidentId, riskLevel: "MEDIUM" });

      await req(app, `/api/incidents/${incidentId}/approvals/${pendingBody.pending[0].approvalId}/decide`, {
        method: "POST",
        cookie,
        organizationId,
        body: { decision: "APPROVE" },
      });

      const after = await req(app, "/api/incidents/approvals/pending", { cookie, organizationId });
      expect((await jsonOf(after)).pending).toHaveLength(0);
    });

    it("a non-admin cannot decide an approval", async () => {
      const incidentId = await createEscalatableIncident();
      const detail = await req(app, `/api/incidents/${incidentId}`, { cookie, organizationId });
      const action = (await jsonOf(detail)).resolutions[0].actions[0];

      const memberEmail = "approver-member@example.com";
      const added = await req(app, "/api/organizations/members", {
        method: "POST",
        cookie,
        organizationId,
        body: { email: memberEmail, role: "MEMBER" },
      });
      const { temporaryPassword } = await jsonOf(added);
      const login = await req(app, "/api/auth/login", {
        method: "POST",
        body: { email: memberEmail, password: temporaryPassword },
      });
      const memberCookie = login.headers.get("set-cookie")!.split(";")[0]!;

      const res = await req(app, `/api/incidents/${incidentId}/approvals/${action.approval.id}/decide`, {
        method: "POST",
        cookie: memberCookie,
        organizationId,
        body: { decision: "APPROVE" },
      });
      expect(res.status).toBe(403);
    });
  });
});
