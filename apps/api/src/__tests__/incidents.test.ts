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
});
