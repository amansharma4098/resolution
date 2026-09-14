import type { MapServerContext } from "../types";
import { McpClient } from "./client";
import { McpConfigSchema } from "./config.schema";

/**
 * Every capability's execute()/discoverCapabilities() calls this first — mirrors
 * fabric/context.ts's fabricClientFromContext, one level more generic since the "client"
 * here is just a URL plus whatever auth the org configured, not a vendor SDK.
 */
export function mcpClientFromContext(ctx: MapServerContext): McpClient {
  const config = McpConfigSchema.parse(ctx.config);
  // TOKEN and API_KEY credentials both land here as a plain bearer token — see
  // packages/credentials/src/credential-payload.ts's CredentialPayloadSchemas (`token` /
  // `apiKey` are its per-type field names). CUSTOM credentials are free-form key/value, so
  // there's no fixed field name to read; an org using CUSTOM auth for their MCP server puts
  // the token under a `token` key by convention, same fallback.
  const bearerToken =
    firstStringField(ctx.credential, ["token", "apiKey"]) ?? undefined;
  return new McpClient({ url: config.url, bearerToken, headers: config.headers });
}

function firstStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
