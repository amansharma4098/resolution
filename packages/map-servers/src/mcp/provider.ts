import { mcpRecoverySpec } from "./verification";
import type { MapServerProvider } from "../types";
import { McpConfigSchema } from "./config.schema";
import { mcpClientFromContext } from "./context";
import { capabilityFromMcpTool, mcpToolFingerprint } from "./capability";

/**
 * The generic MCP (Model Context Protocol) connector — one provider that lets an org point
 * Resolution at *any* MCP server they already run (their own internal tools, or a public
 * one — GitHub, Postgres, Grafana, …) instead of this platform needing a hand-built
 * `packages/map-servers/<vendor>/` folder per system. Its capability set genuinely can't be
 * known at registration time (unlike every other provider here) — see `discoverCapabilities`
 * below and types.ts's comment on that field.
 *
 * Deliberately out of scope for this first pass: OAuth / dynamic client registration for
 * MCP servers that require it (a growing share of public hosted ones) — only a static
 * bearer token (`TOKEN`/`API_KEY`/`CUSTOM` credential) is supported today, which covers
 * self-hosted and internal MCP servers, the likely first use case. Tracked as a follow-up.
 */
export const mcpProvider: MapServerProvider = {
  type: "MCP",
  metadata: {
    displayName: "MCP Server (generic)",
    docsUrl: "https://modelcontextprotocol.io",
    isMock: false,
  },
  configSchema: McpConfigSchema,
  authAdapter: {
    authenticationTypes: ["TOKEN", "API_KEY", "CUSTOM"],
    testConnection: async (ctx) => {
      try {
        const client = mcpClientFromContext(ctx);
        await client.initialize();
        return { status: "CONNECTED" };
      } catch (err) {
        return {
          status: "DISCONNECTED",
          detail: err instanceof Error ? err.message : "Connection failed",
        };
      }
    },
  },
  // Always empty — see types.ts's comment on `discoverCapabilities`. Kept as `[]` rather
  // than omitted so every generic array operation elsewhere (the catalog's
  // `capabilities.length`, `createCapabilitiesFromProvider`) keeps working unmodified.
  capabilities: [],
  discoverCapabilities: async (ctx) => {
    const client = mcpClientFromContext(ctx);
    const tools = await client.listTools();
    const config = McpConfigSchema.parse(ctx.config);
    return Promise.all(
      tools.map(async (tool) => {
        const review = config.toolReviews[tool.name];
        const fingerprint = await mcpToolFingerprint(tool);
        const rule = config.recoveryRules[tool.name];
        const verifier = rule && tools.find((t) => t.name === rule.tool);
        const canVerify =
          rule &&
          verifier &&
          review?.access === "WRITE" &&
          review.fingerprint === fingerprint &&
          rule.actionFingerprint === fingerprint &&
          config.toolReviews[rule.tool]?.access === "READ" &&
          rule.verifierFingerprint === config.toolReviews[rule.tool]?.fingerprint &&
          rule.verifierFingerprint === (await mcpToolFingerprint(verifier));
        return {
          ...(canVerify ? { verification: mcpRecoverySpec(rule) } : {}),
          ...capabilityFromMcpTool(tool, review?.fingerprint === fingerprint ? review : undefined),
          definition: {
            fingerprint,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
          },
        };
      }),
    );
  },
  healthCheck: async (ctx) => {
    try {
      const client = mcpClientFromContext(ctx);
      const tools = await client.listTools();
      return { status: "CONNECTED", detail: `${tools.length} tool(s) available` };
    } catch (err) {
      return {
        status: "DISCONNECTED",
        detail: err instanceof Error ? err.message : "Connection failed",
      };
    }
  },
};
