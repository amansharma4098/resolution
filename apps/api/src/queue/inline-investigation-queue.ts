import type { PrismaClient } from "@resolution/database";
import { processInvestigationMessage, type InvestigationRunnerConfig } from "./investigation-consumer";
import type { IncidentInvestigationQueue, InvestigationQueueMessage } from "./types";

/** Same rationale as inline-queue.ts's createInlineIngestionQueue — runs the real consumer
 *  logic synchronously, awaited, so tests/local dev see a completed investigation (or an
 *  escalation) by the time a webhook's follow-up request runs, without Miniflare's Queue
 *  emulation. Defaults to MOCK_MODE's deterministic LLM unless the caller's config says
 *  otherwise, so this never makes a real network call in CI. */
export function createInlineInvestigationQueue(
  db: PrismaClient,
  config: InvestigationRunnerConfig,
): IncidentInvestigationQueue {
  return {
    async send(message: InvestigationQueueMessage): Promise<void> {
      await processInvestigationMessage(db, config, message);
    },
  };
}
