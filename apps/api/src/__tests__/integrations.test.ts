import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, signupWithOrg } from "./test-helpers";

describe("integration routes", () => {
  let app: FastifyInstance;
  let cookies: Record<string, string>;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
    ({ cookies, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("creates and lists an integration", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/integrations",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "JIRA", name: "Team Jira", config: { projectKey: "OPS" } },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().integration.status).toBe("UNCONFIGURED");

    const list = await app.inject({
      method: "GET",
      url: "/api/integrations",
      cookies,
      headers: { "x-organization-id": organizationId },
    });
    expect(list.json().integrations).toHaveLength(1);
    expect(list.json().integrations[0].name).toBe("Team Jira");
  });

  it("rejects an unknown incident source type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/integrations",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "EMAIL", name: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("isolates integrations per organization", async () => {
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "SERVICENOW", name: "SNow" },
    });

    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const list = await app.inject({
      method: "GET",
      url: "/api/integrations",
      cookies: other.cookies,
      headers: { "x-organization-id": other.organizationId },
    });
    expect(list.json().integrations).toHaveLength(0);
  });

  it("deletes an integration", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/integrations",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "PAGERDUTY", name: "PD" },
    });
    const id = created.json().integration.id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/integrations/${id}`,
      cookies,
      headers: { "x-organization-id": organizationId },
    });
    expect(del.statusCode).toBe(204);
  });
});
