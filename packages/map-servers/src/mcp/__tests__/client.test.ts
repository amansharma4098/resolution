import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClient, McpError } from "../client";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("McpClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("initializes once, sends the initialized notification, then lists tools", async () => {
    const calls: { url: string; body: { method: string }; headers: Record<string, string> }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      calls.push({ url, body, headers: init.headers as Record<string, string> });
      if (body.method === "initialize") {
        return jsonResponse(
          { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } },
          { headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              { name: "get_thing", description: "Gets a thing", inputSchema: { type: "object" } },
            ],
          },
        });
      }
      throw new Error(`unexpected method ${body.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({ url: "https://mcp.example.com" });
    const tools = await client.listTools();

    expect(tools).toEqual([
      { name: "get_thing", description: "Gets a thing", inputSchema: { type: "object" } },
    ]);
    expect(calls.map((c) => c.body.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    // The session id captured from initialize's response is sent on every later request.
    expect(calls[2]!.headers["Mcp-Session-Id"]).toBe("sess-1");
  });

  it("only initializes once across multiple calls", async () => {
    let initCount = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") {
        initCount += 1;
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18" },
        });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list")
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({ url: "https://mcp.example.com" });
    await client.listTools();
    await client.listTools();

    expect(initCount).toBe(1);
  });

  it("sends the bearer token and extra headers on every request", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer secret-token");
      expect(headers["X-Tenant"]).toBe("acme");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({
      url: "https://mcp.example.com",
      bearerToken: "secret-token",
      headers: { "X-Tenant": "acme" },
    });
    await client.listTools();
  });

  it("calls a tool and returns its content", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize")
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18" },
        });
      if (body.method === "tools/call") {
        expect(body.params).toEqual({ name: "get_thing", arguments: { id: "1" } });
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "ok" }] },
        });
      }
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({ url: "https://mcp.example.com" });
    const result = await client.callTool("get_thing", { id: "1" });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("parses a single-event SSE response", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize")
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18" },
        });
      const sseBody = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\n\n`;
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({ url: "https://mcp.example.com" });
    await expect(client.listTools()).resolves.toEqual([]);
  });

  it("throws McpError on a JSON-RPC error response", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize")
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18" },
        });
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({ url: "https://mcp.example.com" });
    await expect(client.listTools()).rejects.toThrow(McpError);
  });

  it("throws McpError when the server can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const client = new McpClient({ url: "https://mcp.example.com" });
    await expect(client.listTools()).rejects.toThrow(McpError);
  });

  it("throws McpError on a non-2xx HTTP response", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize")
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18" },
        });
      return new Response("unauthorized", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpClient({ url: "https://mcp.example.com" });
    await expect(client.listTools()).rejects.toThrow(McpError);
  });
});
