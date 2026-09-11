import type { PrismaClient } from "@resolution/database";
import { processIngestionMessage } from "./consumer";
import type { IncidentIngestionQueue, IngestionQueueMessage } from "./types";

/**
 * Tests and local dev don't run under Miniflare's real Queue emulation (plain Vitest +
 * Hono's `app.request()`) — this stands in for the real Cloudflare Queue binding by
 * running the exact same consumer logic synchronously, awaited before `send()` resolves.
 * Same processing, same idempotency guarantees; the only difference from production is
 * that "enqueued" and "processed" happen in the same tick instead of being decoupled by a
 * real queue. See apps/api/src/worker.ts for the real binding-backed implementation.
 */
export function createInlineIngestionQueue(db: PrismaClient): IncidentIngestionQueue {
  return {
    async send(message: IngestionQueueMessage): Promise<void> {
      await processIngestionMessage(db, message);
    },
  };
}
