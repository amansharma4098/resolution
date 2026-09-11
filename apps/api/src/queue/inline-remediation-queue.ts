import type { PrismaClient } from "@resolution/database";
import { processRemediationMessage, type RemediationRunnerConfig } from "./remediation-consumer";
import type { IncidentRemediationQueue, RemediationQueueMessage } from "./types";

/** Same rationale as the other two inline stand-ins — runs the real consumer synchronously,
 *  awaited, instead of a real decoupled Cloudflare Queue. Defaults `sleep` to a no-op is the
 *  CALLER's responsibility (via `config.sleep`) if a test wants the bounded verification
 *  retry loop to run instantly instead of with real delays. */
export function createInlineRemediationQueue(
  db: PrismaClient,
  config: RemediationRunnerConfig,
): IncidentRemediationQueue {
  return {
    async send(message: RemediationQueueMessage): Promise<void> {
      await processRemediationMessage(db, config, message);
    },
  };
}
