import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("integration routes", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("creates and lists an integration", async () => {
    const create = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "JIRA", name: "Team Jira", config: { projectKey: "OPS" } },
    });
    expect(create.status).toBe(201);
    expect((await jsonOf(create)).integration.status).toBe("UNCONFIGURED");

    const list = await req(app, "/api/integrations", { cookie, tenantId });
    const listBody = await jsonOf(list);
    expect(listBody.integrations).toHaveLength(1);
    expect(listBody.integrations[0].name).toBe("Team Jira");
  });

  it("rejects an unknown incident source type", async () => {
    const res = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "EMAIL", name: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("isolates integrations per organization", async () => {
    await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "SERVICENOW", name: "SNow" },
    });

    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const list = await req(app, "/api/integrations", {
      cookie: other.cookie,
      tenantId: other.tenantId,
    });
    expect((await jsonOf(list)).integrations).toHaveLength(0);
  });

  it("deletes an integration", async () => {
    const created = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "PAGERDUTY", name: "PD" },
    });
    const id = (await jsonOf(created)).integration.id;

    const del = await req(app, `/api/integrations/${id}`, { method: "DELETE", cookie, tenantId });
    expect(del.status).toBe(204);
  });

  it("auto-provisions a matching DATADOG MCP Server alongside a DATADOG integration, so the credential is entered once", async () => {
    await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "DATADOG", name: "Prod Datadog" },
    });

    const mapServers = await req(app, "/api/map-servers", { cookie, tenantId });
    const list = (await jsonOf(mapServers)).mapServers;
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe("DATADOG");
  });

  it("does not create a second DATADOG MCP Server if one already exists", async () => {
    await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "DATADOG", name: "Already here" },
    });

    await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "DATADOG", name: "Prod Datadog" },
    });

    const mapServers = await req(app, "/api/map-servers", { cookie, tenantId });
    expect((await jsonOf(mapServers)).mapServers).toHaveLength(1);
  });

  it("does not auto-provision an MCP Server for a source type with no capability-provider counterpart (e.g. JIRA)", async () => {
    await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "JIRA", name: "Team Jira" },
    });

    const mapServers = await req(app, "/api/map-servers", { cookie, tenantId });
    expect((await jsonOf(mapServers)).mapServers).toHaveLength(0);
  });
});
