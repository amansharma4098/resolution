import type { MiddlewareHandler } from "hono";
import type { ApiKeyRepository } from "@resolution/database";
import { hashApiKey } from "@resolution/security";
import { UnauthorizedError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * The `Authorization: Bearer <key>` counterpart to authenticate.ts's session-cookie
 * middleware — for a caller that can't hold a browser cookie (POST /api/mcp). Sets exactly
 * the same `c.set("userId", ...)` a session does, so anything downstream that only cares
 * about "who is this" (not "how did they prove it") works unmodified either way.
 * Deliberately does NOT resolve an organization — unlike a browser session, one API key's
 * caller may act across several orgs in the same session (an MCP tool call takes
 * `organizationId` as an argument), so tenant membership is checked per-call at the route,
 * not once here.
 */
export function authenticateApiKey(apiKeys: ApiKeyRepository): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    if (!token) {
      throw new UnauthorizedError("Missing or malformed Authorization header");
    }

    const keyHash = await hashApiKey(token);
    const apiKey = await apiKeys.findValidByHash(keyHash);
    if (!apiKey) {
      throw new UnauthorizedError("Invalid or revoked API key");
    }

    await apiKeys.touchLastUsed(apiKey.id);

    c.set("userId", apiKey.userId);
    c.set("apiKeyId", apiKey.id);
    await next();
  };
}
