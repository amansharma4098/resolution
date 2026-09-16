import type { SecretProvider } from "@resolution/credentials";
import { syncSource } from "../lib/source-sync";
import { closeIncidentSource } from "../lib/source-closure";
import type { PrismaClient } from "@resolution/database";
import { processIngestionMessage } from "./consumer";
import type {
  IncidentIngestionQueue,
  IncidentInvestigationQueue,
  IngestionQueueMessage,
} from "./types";

/**
 * Tests and local dev don't run under Miniflare's real Queue emulation (plain Vitest +
 * Hono's `app.request()`) — this stands in for the real Cloudflare Queue binding by
 * running the exact same consumer logic synchronously, awaited before `send()` resolves.
 * Same processing, same idempotency guarantees; the only difference from production is
 * that "enqueued" and "processed" happen in the same tick instead of being decoupled by a
 * real queue. See apps/api/src/worker.ts for the real binding-backed implementation.
 *
 * `investigationQueue` is optional so packages that don't care about Phase 7 (most existing
 * tests) don't have to wire one up — when omitted, a newly-created incident simply isn't
 * investigated, same as before this phase existed.
 */
export function createInlineIngestionQueue(
  db: PrismaClient,
  investigationQueue?: IncidentInvestigationQueue,
  secretProvider?: SecretProvider,
): IncidentIngestionQueue {
  const queue: IncidentIngestionQueue = {
    async send(message: IngestionQueueMessage): Promise<void> {
      if (message.kind) {
        if (!secretProvider) throw new Error("Source maintenance needs a secret provider");
        if (message.kind === "SYNC")
          await syncSource(db, secretProvider, queue, message.integrationId);
        else if (message.incidentId && message.tenantId)
          await closeIncidentSource(db, secretProvider, message.tenantId, message.incidentId);
        return;
      }
      await processIngestionMessage(db, message, {
        onIncidentCreated: investigationQueue ? (evt) => investigationQueue.send(evt) : undefined,
      });
    },
  };
  return queue;
}
