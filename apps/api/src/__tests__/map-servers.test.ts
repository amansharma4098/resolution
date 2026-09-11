import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { z } from "zod";
import {
  __resetRegistryForTests,
  fabricProvider,
  registerMapServer,
  type MapServerProvider,
} from "@resolution/map-servers";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

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
  let app: Hono<AppEnv>;
  let cookie: string;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  afterEach(() => {
    __resetRegistryForTests();
  });

  it("the catalog lists every MapServerType, unavailable by default", async () => {
    const res = await req(app, "/api/map-servers/catalog", { cookie, organizationId });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const catalog = body.catalog as { type: string; available: boolean }[];
    expect(catalog.find((e) => e.type === "FABRIC")?.available).toBe(false);
  });

  it("creates a Map Server for a type with no registered provider — honestly UNCONFIGURED, not fake-connected", async () => {
    const res = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "FABRIC", name: "Prod Fabric", environments: ["prod"], config: {} },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.mapServer.status).toBe("UNCONFIGURED");
    expect(body.mapServer.isMock).toBe(false);
  });

  it("test on an unregistered provider reports DISCONNECTED with an honest reason", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "FABRIC", name: "Prod Fabric", environments: ["prod"], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const tested = await req(app, `/api/map-servers/${id}/test`, { method: "POST", cookie, organizationId });
    expect(tested.status).toBe(200);
    const testedBody = await jsonOf(tested);
    expect(testedBody.mapServer.status).toBe("DISCONNECTED");
    expect(testedBody.detail).toMatch(/No provider is registered/);
  });

  it("a registered provider's isMock flag flows onto the created Map Server", async () => {
    registerMapServer(fixtureProvider);
    const res = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "DATABRICKS", name: "Test Databricks", environments: [], config: {} },
    });
    expect((await jsonOf(res)).mapServer.isMock).toBe(true);
  });

  it("test succeeds through healthCheck once a credential is attached and a provider is registered", async () => {
    registerMapServer(fixtureProvider);

    const credential = await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      organizationId,
      body: {
        name: "Databricks token",
        provider: "databricks",
        authenticationType: "TOKEN",
        payload: { token: "dapi123" },
      },
    });
    const credentialId = (await jsonOf(credential)).credential.id;

    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "DATABRICKS", name: "Test Databricks", credentialId, environments: ["prod"], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const tested = await req(app, `/api/map-servers/${id}/test`, { method: "POST", cookie, organizationId });
    const testedBody = await jsonOf(tested);
    expect(testedBody.mapServer.status).toBe("CONNECTED");
    expect(testedBody.detail).toBe("fixture always healthy");
  });

  it("rejects an unknown MapServerType", async () => {
    const res = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "NOT_A_REAL_TYPE", name: "x", environments: [], config: {} },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a credentialId from another organization", async () => {
    const otherCred = await signupWithOrg(app, "other@example.com", "Other Org");
    const cred = await req(app, "/api/credentials", {
      method: "POST",
      cookie: otherCred.cookie,
      organizationId: otherCred.organizationId,
      body: { name: "Not yours", provider: "aws", authenticationType: "API_KEY", payload: { apiKey: "x" } },
    });
    const credentialId = (await jsonOf(cred)).credential.id;

    const res = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "AWS", name: "x", credentialId, environments: [], config: {} },
    });
    expect(res.status).toBe(400);
  });
});

describe("map server capability toggling (Fabric, the first real registered provider)", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    registerMapServer(fabricProvider);
  });

  afterEach(() => {
    __resetRegistryForTests();
  });

  it("auto-populates capabilities, all disabled by default, when a registered provider's Map Server is created", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "FABRIC", name: "Prod Fabric", environments: ["prod"], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const detail = await req(app, `/api/map-servers/${id}`, { cookie, organizationId });
    const body = await jsonOf(detail);
    expect(body.capabilities).toHaveLength(5);
    expect(body.capabilities.every((c: { enabled: boolean }) => c.enabled === false)).toBe(true);
    expect(body.capabilities.map((c: { key: string }) => c.key).sort()).toEqual([
      "get_logs",
      "get_pipeline",
      "get_pipeline_run",
      "get_workspace",
      "retry_pipeline",
    ]);
  });

  it("an admin can enable a capability", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "FABRIC", name: "Prod Fabric", environments: ["prod"], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const res = await req(app, `/api/map-servers/${id}/capabilities/get_workspace`, {
      method: "PATCH",
      cookie,
      organizationId,
      body: { enabled: true },
    });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).capability.enabled).toBe(true);

    const detail = await req(app, `/api/map-servers/${id}`, { cookie, organizationId });
    const capabilities = (await jsonOf(detail)).capabilities as { key: string; enabled: boolean }[];
    expect(capabilities.find((c) => c.key === "get_workspace")!.enabled).toBe(true);
    expect(capabilities.find((c) => c.key === "get_pipeline")!.enabled).toBe(false);
  });

  it("404s on toggling a capability key that doesn't exist for this Map Server", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "FABRIC", name: "Prod Fabric", environments: [], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const res = await req(app, `/api/map-servers/${id}/capabilities/not_a_real_capability`, {
      method: "PATCH",
      cookie,
      organizationId,
      body: { enabled: true },
    });
    expect(res.status).toBe(404);
  });

  it("a type with no registered provider gets no capability rows at all", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      organizationId,
      body: { type: "SPLUNK", name: "Splunk", environments: [], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const detail = await req(app, `/api/map-servers/${id}`, { cookie, organizationId });
    expect((await jsonOf(detail)).capabilities).toHaveLength(0);
  });
});
