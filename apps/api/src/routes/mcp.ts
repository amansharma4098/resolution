import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient, OrganizationRepository } from "@resolution/database";
import { ApiKeyRepository } from "@resolution/database";
import type { SecretProvider } from "@resolution/credentials";
import type { LlmClient } from "@resolution/ai";
import type { Env } from "../env";
import { authenticateApiKey } from "../middleware/authenticate-api-key";
import { TOOLS, callIncidentTool } from "../lib/incident-tools";
import type { AppEnv } from "../types";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

/**
 * Exposes this platform's own incident data — and its resolution flow — as an MCP server,
 * so a user's own MCP client (Claude Desktop, another agent) can investigate, propose a
 * remediation, and approve/reject it without opening the dashboard. The mirror image of
 * packages/map-servers/src/mcp (which lets Resolution's agent *consume* an org's MCP
 * servers) — this is Resolution being one instead.
 *
 * The tool catalog and its execution live in ../lib/incident-tools.ts, shared with
 * routes/chat.ts's in-app assistant — one definition of what an authenticated caller can do
 * to an incident, reused by both entry points.
 */
export function buildMcpRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
  investigationQueue: IncidentInvestigationQueue;
  remediationQueue: IncidentRemediationQueue;
  secretProvider: SecretProvider;
  llmClient: LlmClient;
}): Hono<AppEnv> {
  const { db } = deps;
  const router = new Hono<AppEnv>();
  const apiKeys = new ApiKeyRepository(db);
  const auth = authenticateApiKey(apiKeys);

  // One endpoint, JSON-RPC-dispatched per MCP's Streamable HTTP transport — see
  // packages/map-servers/src/mcp/client.ts's header comment for the transport this mirrors.
  router.post("/", auth, async (c) => {
    const userId = c.get("userId")!;
    const body = (await c.req.json()) as JsonRpcRequest;

    // A notification (no `id`) never gets a body back — the client's
    // `notifications/initialized` after our `initialize` response arrives this way.
    if (body.id === undefined) {
      return c.body(null, 202);
    }

    switch (body.method) {
      case "initialize":
        return c.json(
          jsonRpcResult(body.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "resolution", version: "0.1.0" },
          }),
        );

      case "tools/list":
        return c.json(jsonRpcResult(body.id, { tools: TOOLS }));

      case "tools/call": {
        const params = z
          .object({ name: z.string(), arguments: z.record(z.unknown()).default({}) })
          .safeParse(body.params);
        if (!params.success) {
          return c.json(jsonRpcError(body.id, -32602, "Invalid params"));
        }
        const result = await callIncidentTool(
          deps,
          userId,
          c.get("requestId"),
          params.data.name,
          params.data.arguments,
        );
        return c.json(jsonRpcResult(body.id, result));
      }

      default:
        return c.json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
    }
  });

  return router;
}
