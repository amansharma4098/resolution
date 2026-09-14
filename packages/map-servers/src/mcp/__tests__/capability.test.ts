import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityFromMcpTool } from "../capability";
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
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("capabilityFromMcpTool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults an undeclared tool to HIGH risk and mutating — safe by default", () => {
    const capability = capabilityFromMcpTool({ name: "do_thing", inputSchema: {} });
    expect(capability.riskLevel).toBe("HIGH");
    expect(capability.mutating).toBe(true);
  });

  it("relaxes to LOW/non-mutating only when the server declares readOnlyHint", () => {
    const capability = capabilityFromMcpTool({
      name: "get_thing",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    });
    expect(capability.riskLevel).toBe("LOW");
    expect(capability.mutating).toBe(false);
  });

  it("calls the tool via the MCP client and returns its content", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "42" }] },
        });
      }
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const capability = capabilityFromMcpTool({ name: "get_thing", inputSchema: { type: "object" } });
    const result = await capability.execute(ctx, {});
    expect(result).toEqual({ content: [{ type: "text", text: "42" }] });
  });

  it("throws when the tool call reports isError, surfacing the tool's own error text", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "not found" }], isError: true },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const capability = capabilityFromMcpTool({ name: "get_thing", inputSchema: {} });
    await expect(capability.execute(ctx, {})).rejects.toThrow(/not found/);
  });

  it("validates input against the tool's translated schema", () => {
    const capability = capabilityFromMcpTool({
      name: "get_thing",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    });
    expect(() => capability.inputSchema.parse({})).toThrow();
    expect(capability.inputSchema.parse({ id: "x" })).toEqual({ id: "x" });
  });
});
