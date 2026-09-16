import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import {
  __resetRegistryForTests,
  fabricProvider,
  mcpToolFingerprint,
  mcpProvider,
  registerMapServer,
} from "@resolution/map-servers";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Stubs global fetch as a minimal MCP server reporting the given tools. */
function stubMcpServer(tools: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize")
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18" },
        });
      if (body.method === "tools/list")
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools } });
      throw new Error(`unexpected MCP method in test: ${body.method}`);
    }),
  );
}

describe("MCP generic Map Server connector", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    registerMapServer(mcpProvider);
  });

  afterEach(() => {
    __resetRegistryForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creating one seeds zero capabilities — they're only known once discovered live", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: {
        type: "MCP",
        name: "Internal tools",
        environments: [],
        config: { url: "https://mcp.example.com" },
      },
    });
    expect(created.status).toBe(201);
    const id = (await jsonOf(created)).mapServer.id;

    const fetched = await req(app, `/api/map-servers/${id}`, { cookie, tenantId });
    expect((await jsonOf(fetched)).capabilities).toEqual([]);
  });

  it("refresh-capabilities requires a credential first", async () => {
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: {
        type: "MCP",
        name: "Internal tools",
        environments: [],
        config: { url: "https://mcp.example.com" },
      },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const res = await req(app, `/api/map-servers/${id}/refresh-capabilities`, {
      method: "POST",
      cookie,
      tenantId,
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.message).toMatch(/Attach a credential/);
  });

  it("400s for a provider with a fixed capability set (no discoverCapabilities)", async () => {
    registerMapServer(fabricProvider);
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: { type: "FABRIC", name: "Prod Fabric", environments: [], config: {} },
    });
    const id = (await jsonOf(created)).mapServer.id;

    const res = await req(app, `/api/map-servers/${id}/refresh-capabilities`, {
      method: "POST",
      cookie,
      tenantId,
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.message).toMatch(/fixed capability set/);
  });

  it("discovers tools from the org's live server and seeds them disabled, requiring explicit review regardless of readOnlyHint", async () => {
    const credential = await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      tenantId,
      body: {
        name: "MCP token",
        provider: "mcp",
        authenticationType: "TOKEN",
        payload: { token: "secret" },
      },
    });
    const credentialId = (await jsonOf(credential)).credential.id;

    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: {
        type: "MCP",
        name: "Internal tools",
        credentialId,
        environments: [],
        config: { url: "https://mcp.example.com" },
      },
    });
    const id = (await jsonOf(created)).mapServer.id;

    stubMcpServer([
      {
        name: "get_status",
        description: "Read status",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      { name: "restart_service", description: "Restarts a service", inputSchema: {} },
    ]);

    const refreshed = await req(app, `/api/map-servers/${id}/refresh-capabilities`, {
      method: "POST",
      cookie,
      tenantId,
    });
    expect(refreshed.status).toBe(200);
    const capabilities = (await jsonOf(refreshed)).capabilities as {
      key: string;
      enabled: boolean;
      riskLevel: string;
      mutating: boolean;
    }[];
    expect(capabilities).toHaveLength(2);
    const readOnly = capabilities.find((c) => c.key === "get_status")!;
    expect(readOnly.enabled).toBe(false);
    expect(readOnly.riskLevel).toBe("HIGH");
    expect(readOnly.mutating).toBe(true);
    const mutating = capabilities.find((c) => c.key === "restart_service")!;
    expect(mutating.riskLevel).toBe("HIGH");
    expect(mutating.mutating).toBe(true);
  });

  it("refreshing disables capabilities until the administrator reviews them again", async () => {
    const credential = await req(app, "/api/credentials", {
      method: "POST",
      cookie,
      tenantId,
      body: {
        name: "MCP token",
        provider: "mcp",
        authenticationType: "TOKEN",
        payload: { token: "secret" },
      },
    });
    const credentialId = (await jsonOf(credential)).credential.id;
    const created = await req(app, "/api/map-servers", {
      method: "POST",
      cookie,
      tenantId,
      body: {
        type: "MCP",
        name: "Internal tools",
        credentialId,
        environments: [],
        config: { url: "https://mcp.example.com" },
      },
    });
    const id = (await jsonOf(created)).mapServer.id;

    stubMcpServer([{ name: "get_status", description: "Read status", inputSchema: {} }]);
    await req(app, `/api/map-servers/${id}/refresh-capabilities`, {
      method: "POST",
      cookie,
      tenantId,
    });
    await req(app, `/api/map-servers/${id}/capabilities/get_status`, {
      method: "PATCH",
      cookie,
      tenantId,
      body: {
        enabled: true,
        access: "READ",
        fingerprint: await mcpToolFingerprint({
          name: "get_status",
          description: "Read status",
          inputSchema: {},
        }),
      },
    });

    const refreshedAgain = await req(app, `/api/map-servers/${id}/refresh-capabilities`, {
      method: "POST",
      cookie,
      tenantId,
    });
    const capabilities = (await jsonOf(refreshedAgain)).capabilities as {
      key: string;
      enabled: boolean;
    }[];
    expect(capabilities.find((c) => c.key === "get_status")!.enabled).toBe(false);
  });
});
