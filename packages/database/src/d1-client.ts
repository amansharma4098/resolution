import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * The Worker-runtime counterpart to client.ts's Node-process `prisma` singleton. Cloudflare
 * Workers have no filesystem, so the plain `file:` URL PrismaClient used in local dev/tests
 * can't run there — this binds Prisma to the D1 database via the account's `DB` binding
 * instead (see apps/api/wrangler.toml). One call per request is fine: D1 bindings are cheap
 * to wrap, and Workers don't share module-level state safely across requests the way a
 * long-lived Node process does, so this deliberately isn't a cached singleton.
 */
export function createD1Client(d1: D1Database): PrismaClient {
  const adapter = new PrismaD1(d1);
  return new PrismaClient({ adapter });
}
