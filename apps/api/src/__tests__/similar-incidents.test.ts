import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { FakeDb } from "./fake-db";
import type { AppEnv } from "../types";

/** Seeds a fully resolved past incident — RCA, a proposed resolution, and a succeeded
 *  remediation action — so `find_similar_incidents`/GET /:id has real precedent to surface,
 *  not just a bare Incident row. */
async function seedResolvedIncident(
  db: FakeDb,
  tenantId: string,
  overrides: { title: string; service?: string | null; source?: string; outcome?: "SUCCEEDED" | "FAILED" },
) {
  const incident = await db.incident.create({
    data: {
      tenantId,
      externalId: `ext-${Math.random()}`,
      source: overrides.source ?? "DATADOG",
      title: overrides.title,
      description: "A past incident",
      severity: "HIGH",
      priority: "P2",
      status: "RESOLVED",
      service: overrides.service ?? null,
      affectedSystem: overrides.source ?? "DATADOG",
      metadata: {},
    },
  });
  const rca = await db.rootCauseAnalysis.create({
    data: { incidentId: incident.id, summary: "Disk filled up from an unrotated log file", confidence: 0.9 },
  });
  const resolution = await db.resolution.create({
    data: {
      incidentId: incident.id,
      rcaId: rca.id,
      proposedAction: "Rotate and truncate the offending log file",
      riskLevel: "LOW",
    },
  });
  await db.remediationAction.create({
    data: { resolutionId: resolution.id, status: overrides.outcome ?? "SUCCEEDED", idempotencyKey: `${incident.id}-key` },
  });
  return incident;
}

describe("similar past incident recall", () => {
  let app: Hono<AppEnv>;
  let db: FakeDb;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("GET /api/incidents/:id includes similar past incidents with root cause, action taken, and outcome", async () => {
    await seedResolvedIncident(db, tenantId, { title: "Disk usage above 95% on payments-api", service: "payments-api" });

    const current = await db.incident.create({
      data: {
        tenantId,
        externalId: "ext-current",
        source: "DATADOG",
        title: "Disk usage above 95% on payments-api",
        description: "Same thing again",
        severity: "HIGH",
        priority: "P2",
        status: "NEW",
        service: "payments-api",
        affectedSystem: "DATADOG",
        metadata: {},
      },
    });

    const res = await req(app, `/api/incidents/${current.id}`, { cookie, tenantId });
    const body = await jsonOf(res);
    expect(body.similarIncidents).toHaveLength(1);
    expect(body.similarIncidents[0].rootCause).toBe("Disk filled up from an unrotated log file");
    expect(body.similarIncidents[0].actionTaken).toBe("Rotate and truncate the offending log file");
    expect(body.similarIncidents[0].outcome).toBe("succeeded");
    expect(body.similarIncidents[0].matchedOn).toContain("service");
  });

  it("never surfaces an unrelated resolved incident as similar", async () => {
    await seedResolvedIncident(db, tenantId, { title: "Login page returns 500", service: "auth-service", source: "JIRA" });

    const current = await db.incident.create({
      data: {
        tenantId,
        externalId: "ext-current",
        source: "DATADOG",
        title: "Disk usage above 95% on payments-api",
        description: "Nothing to do with auth",
        severity: "HIGH",
        priority: "P2",
        status: "NEW",
        service: "payments-api",
        affectedSystem: "DATADOG",
        metadata: {},
      },
    });

    const res = await req(app, `/api/incidents/${current.id}`, { cookie, tenantId });
    expect((await jsonOf(res)).similarIncidents).toHaveLength(0);
  });

  it("isolates similar-incident recall per tenant", async () => {
    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    await seedResolvedIncident(db, other.tenantId, { title: "Disk usage above 95% on payments-api", service: "payments-api" });

    const current = await db.incident.create({
      data: {
        tenantId,
        externalId: "ext-current",
        source: "DATADOG",
        title: "Disk usage above 95% on payments-api",
        description: "Same title, different tenant",
        severity: "HIGH",
        priority: "P2",
        status: "NEW",
        service: "payments-api",
        affectedSystem: "DATADOG",
        metadata: {},
      },
    });

    const res = await req(app, `/api/incidents/${current.id}`, { cookie, tenantId });
    expect((await jsonOf(res)).similarIncidents).toHaveLength(0);
  });

  it("find_similar_incidents tool (shared by chat and MCP) returns the same recall", async () => {
    await seedResolvedIncident(db, tenantId, { title: "Disk usage above 95% on payments-api", service: "payments-api" });
    const current = await db.incident.create({
      data: {
        tenantId,
        externalId: "ext-current",
        source: "DATADOG",
        title: "Disk usage above 95% on payments-api",
        description: "Same thing again",
        severity: "HIGH",
        priority: "P2",
        status: "NEW",
        service: "payments-api",
        affectedSystem: "DATADOG",
        metadata: {},
      },
    });

    const apiKeyRes = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Claude Desktop" } });
    const apiKey = (await jsonOf(apiKeyRes)).token;

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "find_similar_incidents", arguments: { tenantId, incidentId: current.id } },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].outcome).toBe("succeeded");
  });
});
