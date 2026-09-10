import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { buildTestApp, signupWithOrg } from "./test-helpers";

const fixtureProvider: MapServerProvider = {
  type: "DATABRICKS",
  metadata: { displayName: "Databricks (fixture)", isMock: true },
  configSchema: z.object({ workspaceUrl: z.string() }),
  authAdapter: {
    authenticationTypes: ["SERVICE_PRINCIPAL"],
    testConnection: async () => ({ status: "CONNECTED" }),
  },
  capabilities: [
    {
      key: "get_job_run",
      description: "Fetch a job run",
      riskLevel: "LOW",
      mutating: false,
      inputSchema: z.object({ runId: z.string() }),
      outputSchema: z.object({ status: z.string() }),
      execute: async () => ({ status: "SUCCESS" }),
    },
  ],
  healthCheck: async () => ({ status: "CONNECTED", detail: "fixture always healthy" }),
};

describe("map server routes", () => {
  let app: FastifyInstance;
  let cookies: Record<string, string>;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
    ({ cookies, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  afterEach(() => {
    __resetRegistryForTests();
  });

  it("the catalog lists every MapServerType, unavailable by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/map-servers/catalog",
      cookies,
      headers: { "x-organization-id": organizationId },
    });
    expect(res.statusCode).toBe(200);
    const catalog = res.json().catalog as { type: string; available: boolean }[];
    expect(catalog.find((e) => e.type === "FABRIC")?.available).toBe(false);
  });

  it("creates a Map Server for a type with no registered provider — honestly UNCONFIGURED, not fake-connected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/map-servers",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "FABRIC", name: "Prod Fabric", environments: ["prod"], config: {} },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().mapServer.status).toBe("UNCONFIGURED");
    expect(res.json().mapServer.isMock).toBe(false);
  });

  it("test on an unregistered provider reports DISCONNECTED with an honest reason", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/map-servers",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "FABRIC", name: "Prod Fabric", environments: ["prod"], config: {} },
    });
    const id = created.json().mapServer.id;

    const tested = await app.inject({
      method: "POST",
      url: `/api/map-servers/${id}/test`,
      cookies,
      headers: { "x-organization-id": organizationId },
    });
    expect(tested.statusCode).toBe(200);
    expect(tested.json().mapServer.status).toBe("DISCONNECTED");
    expect(tested.json().detail).toMatch(/No provider is registered/);
  });

  it("a registered provider's isMock flag flows onto the created Map Server", async () => {
    registerMapServer(fixtureProvider);
    const res = await app.inject({
      method: "POST",
      url: "/api/map-servers",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "DATABRICKS", name: "Test Databricks", environments: [], config: {} },
    });
    expect(res.json().mapServer.isMock).toBe(true);
  });

  it("test succeeds through healthCheck once a credential is attached and a provider is registered", async () => {
    registerMapServer(fixtureProvider);

    const credential = await app.inject({
      method: "POST",
      url: "/api/credentials",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: {
        name: "Databricks token",
        provider: "databricks",
        authenticationType: "TOKEN",
        payload: { token: "dapi123" },
      },
    });
    const credentialId = credential.json().credential.id;

    const created = await app.inject({
      method: "POST",
      url: "/api/map-servers",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: {
        type: "DATABRICKS",
        name: "Test Databricks",
        credentialId,
        environments: ["prod"],
        config: {},
      },
    });
    const id = created.json().mapServer.id;

    const tested = await app.inject({
      method: "POST",
      url: `/api/map-servers/${id}/test`,
      cookies,
      headers: { "x-organization-id": organizationId },
    });
    expect(tested.json().mapServer.status).toBe("CONNECTED");
    expect(tested.json().detail).toBe("fixture always healthy");
  });

  it("rejects an unknown MapServerType", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/map-servers",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "NOT_A_REAL_TYPE", name: "x", environments: [], config: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a credentialId from another organization", async () => {
    const otherCred = await signupWithOrg(app, "other@example.com", "Other Org");
    const cred = await app.inject({
      method: "POST",
      url: "/api/credentials",
      cookies: otherCred.cookies,
      headers: { "x-organization-id": otherCred.organizationId },
      payload: {
        name: "Not yours",
        provider: "aws",
        authenticationType: "API_KEY",
        payload: { apiKey: "x" },
      },
    });
    const credentialId = cred.json().credential.id;

    const res = await app.inject({
      method: "POST",
      url: "/api/map-servers",
      cookies,
      headers: { "x-organization-id": organizationId },
      payload: { type: "AWS", name: "x", credentialId, environments: [], config: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});
