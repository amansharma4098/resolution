/**
 * A minimal MCP (Model Context Protocol) client speaking the "Streamable HTTP" transport —
 * plain JSON-RPC 2.0 over `fetch`, no SDK dependency. Same reasoning as
 * packages/security's `jose` and packages/email's Resend sender: this has to run inside a
 * Cloudflare Worker (ARCHITECTURE.md §2), and the official `@modelcontextprotocol/sdk`
 * targets Node's stdio/HTTP server primitives, not a Workers-native fetch handler.
 *
 * Deliberately narrow: only what an org's `discoverCapabilities`/`execute` calls need —
 * `initialize`, `tools/list`, `tools/call`. No resources/prompts/sampling, no client-side
 * SSE-initiated server notifications, no stdio transport. A server that replies with an
 * SSE stream instead of a single JSON body is still supported (this reads the first `data:`
 * event as the response) since several real MCP servers default to that even for a
 * single-response call; a server that genuinely needs multiple streamed messages per call
 * is out of scope here.
 */

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
  constructor(message: string, public readonly cause?: unknown) {
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

  constructor(private readonly opts: McpClientOptions) {}

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
    // Best-effort per the spec: proceed even on a protocol version mismatch rather than
    // hard-failing — most servers accept an older/newer client than they advertise for the
    // handful of methods this client actually uses.
    void result;
    // The initialization handshake's required follow-up notification — no response
    // expected (and none awaited), just fired to complete the handshake per the spec.
    await this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = await this.rpc<{ tools: McpTool[] }>("tools/list", {});
    return result.tools;
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
        throw new McpError(`MCP server rejected notification "${message.method}" (HTTP ${res.status})`);
      }
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new McpError(`MCP server responded HTTP ${res.status} to "${message.method}": ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return parseFirstSseJsonEvent(await res.text());
    }
    return (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  }
}

/** Pulls the first `data: {...}` line out of an SSE response body and parses it as JSON —
 *  enough for a request/response call where the server happens to answer via SSE framing
 *  instead of a plain JSON body (see this file's header comment on scope). */
function parseFirstSseJsonEvent(body: string): { result?: unknown; error?: { code: number; message: string } } {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const json = trimmed.slice("data:".length).trim();
      try {
        return JSON.parse(json);
      } catch (err) {
        throw new McpError("Could not parse MCP server's SSE response as JSON", err);
      }
    }
  }
  throw new McpError("MCP server's SSE response carried no data event");
}
