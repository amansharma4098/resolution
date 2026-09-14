import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { ApiKeyRepository } from "@resolution/database";
import { apiKeyDisplayHint, generateApiKey, hashApiKey } from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateApiKeyBody = z.object({ name: z.string().min(1).max(200) });

/** Never the hash, never `userId` (the caller already knows who they are) — only what a
 *  "my API keys" list screen needs to show. */
function toPublicApiKey(apiKey: {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    lastUsedAt: apiKey.lastUsedAt,
    createdAt: apiKey.createdAt,
    revokedAt: apiKey.revokedAt,
  };
}

/**
 * Self-service management of the caller's own API keys — the credential POST /api/mcp
 * accepts. Session-authenticated (a browser, not the key itself): creating/listing/revoking
 * keys is a dashboard action, never something an MCP client does to itself.
 */
export function buildApiKeyRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db, env } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const apiKeys = new ApiKeyRepository(db);

  router.get("/", auth, async (c) => {
    const keys = await apiKeys.listByUser(c.get("userId")!);
    return c.json({ apiKeys: keys.map(toPublicApiKey) });
  });

  router.post("/", auth, async (c) => {
    const body = CreateApiKeyBody.parse(await c.req.json());
    const token = generateApiKey();
    const apiKey = await apiKeys.create({
      userId: c.get("userId")!,
      name: body.name,
      keyHash: await hashApiKey(token),
    });
    // The only moment the raw key is ever visible — never returned by GET, never logged,
    // never recoverable afterwards (same one-time-reveal discipline as a generated
    // temporary password — packages/security/src/password.ts's generateTemporaryPassword).
    return c.json({ apiKey: toPublicApiKey(apiKey), token, hint: apiKeyDisplayHint(token) }, 201);
  });

  router.delete("/:id", auth, async (c) => {
    const revoked = await apiKeys.revoke(c.req.param("id"), c.get("userId")!);
    if (!revoked) throw new NotFoundError("API key not found");
    return c.body(null, 204);
  });

  return router;
}
