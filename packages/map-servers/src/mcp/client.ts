import { isPublicMcpUrl } from "./config.schema";
/** Workers-native remote MCP tools client. Supports bounded JSON and SSE replies,
 * catalog pagination, static bearer credentials and protocol 2025-06-18.
 * OAuth, stdio, resources, prompts and server-initiated requests are not implemented. */
const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 15_000;

export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema (draft 2020-12, per the MCP spec) — not a Zod schema. See
   *  json-schema-to-zod.ts for how this package turns it into one on a best-effort basis. */
  inputSchema: Record<string, unknown>;
  /** Optional, server-supplied and explicitly untrusted per the MCP spec itself ("these
   *  hints are not guaranteed... clients should never make security-critical decisions
   *  based solely on these hints") — see capability.ts for how this package uses
   *  `readOnlyHint` anyway, as a signal rather than a guarantee. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export class McpError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export interface McpClientOptions {
  /** The MCP server's endpoint URL (org-configured — see config.schema.ts). */
  url: string;
  /** Bearer token, if the server requires auth — most self-hosted/internal MCP servers do.
   *  Full OAuth/dynamic client registration (what a public hosted MCP server increasingly
   *  requires) is intentionally out of scope for this first pass — see this package's
   *  header comment in provider.ts. */
  bearerToken?: string;
  /** Extra static headers an org's server needs beyond Authorization (e.g. a tenant id). */
  headers?: Record<string, string>;
}

let requestCounter = 0;

export class McpClient {
  private sessionId: string | undefined;
  private initialized = false;

  constructor(private readonly opts: McpClientOptions) {
    if (!isPublicMcpUrl(opts.url))
      throw new McpError("MCP endpoint must use a public HTTPS hostname");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const result = await this.rpc<{ protocolVersion: string }>(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "resolution", version: "0.1.0" },
      },
      { captureSession: true },
    );
    // Fail closed when the server selects an unsupported protocol.
    if (result.protocolVersion !== PROTOCOL_VERSION) {
      throw new McpError("MCP server negotiated an unsupported protocol version");
    }
    // The initialization handshake's required follow-up notification — no response
    // expected (and none awaited), just fired to complete the handshake per the spec.
    await this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const result = await this.rpc<{ tools: McpTool[]; nextCursor?: string }>(
        "tools/list",
        cursor ? { cursor } : {},
      );
      if (!Array.isArray(result.tools)) throw new McpError("Invalid MCP tool catalog");
      tools.push(...result.tools);
      if (tools.length > 1000) throw new McpError("MCP tool catalog exceeds the supported limit");
      cursor = result.nextCursor;
      if (!cursor) return tools;
      if (seen.has(cursor)) throw new McpError("MCP server repeated a pagination cursor");
      seen.add(cursor);
    }
    throw new McpError("MCP tool catalog exceeds the page limit");
  }

  async callTool(name: string, args: unknown): Promise<McpToolCallResult> {
    await this.initialize();
    return this.rpc<McpToolCallResult>("tools/call", { name, arguments: args });
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.send({ jsonrpc: "2.0", method, params });
  }

  private async rpc<T>(
    method: string,
    params: unknown,
    opts: { captureSession?: boolean } = {},
  ): Promise<T> {
    requestCounter += 1;
    const id = requestCounter;
    const body = await this.send({ jsonrpc: "2.0", id, method, params }, opts.captureSession);
    if (body === null) {
      throw new McpError(`MCP server returned no response for "${method}"`);
    }
    if (body.error) {
      throw new McpError(`MCP server error on "${method}": ${body.error.message}`, body.error);
    }
    return body.result as T;
  }

  /** Sends one JSON-RPC message. Returns the parsed response object for a request (one
   *  carrying an `id`), or `null` for a fire-and-forget notification. Handles both a plain
   *  JSON body and a single-event SSE body — see this file's header comment. */
  private async send(
    message: { jsonrpc: "2.0"; id?: number; method: string; params: unknown },
    captureSession = false,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } } | null> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      ...this.opts.headers,
    };
    if (this.opts.bearerToken) headers.Authorization = `Bearer ${this.opts.bearerToken}`;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    let res: Response;
    try {
      res = await fetch(this.opts.url, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new McpError(`Could not reach MCP server at ${this.opts.url}`, err);
    }

    if (captureSession) {
      const sessionId = res.headers.get("mcp-session-id");
      if (sessionId) this.sessionId = sessionId;
    }

    // A notification (no `id`) gets a 202 with no body — nothing to parse.
    if (message.id === undefined) {
      if (!res.ok) {
        throw new McpError(
          `MCP server rejected notification "${message.method}" (HTTP ${res.status})`,
        );
      }
      return null;
    }

    if (!res.ok) {
      throw new McpError(`MCP server responded HTTP ${res.status} to "${message.method}"`);
    }

    return readRpcResponse(res, message.id);
  }
}

type RpcResponse = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Bounded streaming reader: skip notifications and stop at the matching response ID. */
async function readRpcResponse(res: Response, id: number): Promise<RpcResponse> {
  if (!res.body) throw new McpError("MCP server returned an empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const streaming = res.headers.get("content-type")?.includes("text/event-stream");
  let buffer = "";
  let bytes = 0;
  const decode = (value: string): RpcResponse => {
    try {
      return JSON.parse(value) as RpcResponse;
    } catch {
      throw new McpError("MCP server returned invalid JSON");
    }
  };
  const validate = (value: RpcResponse): RpcResponse => {
    if (
      value.jsonrpc !== "2.0" ||
      value.id !== id ||
      (!("result" in value) && !("error" in value))
    ) {
      throw new McpError("MCP response does not match the request");
    }
    return value;
  };
  try {
    while (bytes <= 2 * 1024 * 1024) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 2 * 1024 * 1024) throw new McpError("MCP response exceeds 2 MB");
      buffer += decoder.decode(value, { stream: !done });
      if (streaming) {
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        if (done && buffer.trim()) {
          events.push(buffer);
          buffer = "";
        }
        for (const event of events) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const response = decode(data);
          if (response.id === id) return validate(response);
        }
      }
      if (done) {
        if (!streaming) return validate(decode(buffer));
        throw new McpError("MCP stream ended without a matching response");
      }
    }
    throw new McpError("MCP response exceeds 2 MB");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
