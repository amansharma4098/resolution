import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpProvider } from "../provider";
import type { MapServerContext } from "../../types";

const ctx: MapServerContext = {
  tenantId: "org1",
  mapServerId: "ms1",
  environment: "default",
  credential: { token: "tok" },
  config: { url: "https://mcp.example.com" },
  requestId: "req1",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubMcpServer(tools: unknown[]) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
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
    throw new Error("unexpected");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("mcpProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("declares no static capabilities — it's entirely discovery-driven", () => {
    expect(mcpProvider.capabilities).toEqual([]);
  });

  it("discovers capabilities from the org's live server", async () => {
    stubMcpServer([
      { name: "get_logs", description: "Fetch logs", inputSchema: { type: "object" } },
    ]);
    const discovered = await mcpProvider.discoverCapabilities!(ctx);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.key).toBe("get_logs");
  });

  it("testConnection reports CONNECTED when the handshake succeeds", async () => {
    stubMcpServer([]);
    const result = await mcpProvider.authAdapter.testConnection(ctx);
    expect(result.status).toBe("CONNECTED");
  });

  it("testConnection reports DISCONNECTED when the server can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const result = await mcpProvider.authAdapter.testConnection(ctx);
    expect(result.status).toBe("DISCONNECTED");
  });

  it("healthCheck reports the discovered tool count", async () => {
    stubMcpServer([
      { name: "a", inputSchema: {} },
      { name: "b", inputSchema: {} },
    ]);
    const result = await mcpProvider.healthCheck(ctx);
    expect(result.status).toBe("CONNECTED");
    expect(result.detail).toContain("2 tool(s)");
  });

  it("rejects config missing a url", () => {
    expect(() => mcpProvider.configSchema.parse({})).toThrow();
  });
});
