import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityFromMcpTool, mcpToolFingerprint } from "../capability";
import type { MapServerContext } from "../../types";
import type { McpTool } from "../client";

const tool: McpTool = {
  name: "get_status",
  description: "Read service health",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
};
const ctx: MapServerContext = {
  tenantId: "tenant1",
  mapServerId: "server1",
  environment: "prod",
  credential: { token: "secret-token" },
  config: { url: "https://mcp.example.com" },
  requestId: "request1",
};
function mockServer(liveTool = tool, isError = false) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-06-18" }
        : body.method === "tools/list"
          ? { tools: [liveTool] }
          : { content: [{ type: "text", text: isError ? "not found" : "healthy" }], isError };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
async function reviewedContext() {
  return {
    ...ctx,
    config: {
      ...ctx.config,
      toolReviews: { [tool.name]: { access: "READ", fingerprint: await mcpToolFingerprint(tool) } },
    },
  };
}
describe("MCP reviewed capabilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("does not trust server read-only annotations", () => {
    expect(capabilityFromMcpTool(tool)).toMatchObject({ riskLevel: "HIGH", mutating: true });
  });
  it("classifies a reviewed read tool as read-only", async () => {
    expect(
      capabilityFromMcpTool(tool, { access: "READ", fingerprint: await mcpToolFingerprint(tool) }),
    ).toMatchObject({ mutating: false });
  });
  it("blocks execution without review before sending credentials", async () => {
    const fetch = mockServer();
    await expect(capabilityFromMcpTool(tool).execute(ctx, {})).rejects.toThrow(/review/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("executes a reviewed unchanged tool", async () => {
    mockServer();
    expect(await capabilityFromMcpTool(tool).execute(await reviewedContext(), {})).toMatchObject({
      content: [{ text: "healthy" }],
    });
  });
  it("blocks changed tool definitions before tools/call", async () => {
    const fetch = mockServer({ ...tool, description: "Delete service" });
    await expect(capabilityFromMcpTool(tool).execute(await reviewedContext(), {})).rejects.toThrow(
      /changed/,
    );
    expect(
      fetch.mock.calls.some(([, init]) => JSON.parse(init.body as string).method === "tools/call"),
    ).toBe(false);
  });
  it("blocks a disabled connection", async () => {
    const reviewed = await reviewedContext();
    await expect(
      capabilityFromMcpTool(tool).execute(
        { ...reviewed, config: { ...reviewed.config, disabled: true } },
        {},
      ),
    ).rejects.toThrow(/disabled/);
  });
  it("propagates tool failure", async () => {
    mockServer(tool, true);
    await expect(capabilityFromMcpTool(tool).execute(await reviewedContext(), {})).rejects.toThrow(
      /not found/,
    );
  });
  it("uses stable fingerprints for reordered schema properties", async () => {
    expect(
      await mcpToolFingerprint({ name: "x", inputSchema: { type: "object", properties: {} } }),
    ).toBe(
      await mcpToolFingerprint({ inputSchema: { properties: {}, type: "object" }, name: "x" }),
    );
  });
});
