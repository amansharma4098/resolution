import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("integration routes", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("creates and lists an integration", async () => {
    const create = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "JIRA", name: "Team Jira", config: { projectKey: "OPS" } },
    });
    expect(create.status).toBe(201);
    expect((await jsonOf(create)).integration.status).toBe("UNCONFIGURED");

    const list = await req(app, "/api/integrations", { cookie, organizationId });
    const listBody = await jsonOf(list);
    expect(listBody.integrations).toHaveLength(1);
    expect(listBody.integrations[0].name).toBe("Team Jira");
  });

  it("rejects an unknown incident source type", async () => {
    const res = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "EMAIL", name: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("isolates integrations per organization", async () => {
    await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "SERVICENOW", name: "SNow" },
    });

    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const list = await req(app, "/api/integrations", {
      cookie: other.cookie,
      organizationId: other.organizationId,
    });
    expect((await jsonOf(list)).integrations).toHaveLength(0);
  });

  it("deletes an integration", async () => {
    const created = await req(app, "/api/integrations", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "PAGERDUTY", name: "PD" },
    });
    const id = (await jsonOf(created)).integration.id;

    const del = await req(app, `/api/integrations/${id}`, { method: "DELETE", cookie, organizationId });
    expect(del.status).toBe(204);
  });
});
