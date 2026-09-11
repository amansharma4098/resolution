export type IngestionSource = "JIRA" | "SERVICENOW";

export interface IngestionQueueMessage {
  source: IngestionSource;
  integrationId: string;
  rawBody: string;
}

/**
 * The producer-side interface every webhook route depends on — never Cloudflare's real
 * Queue binding directly, so the same route code runs against the real queue in production
 * (apps/api/src/worker.ts) and a synchronous stand-in in tests/local dev (inline-queue.ts),
 * with no branching in the route itself.
 */
export interface IncidentIngestionQueue {
  send(message: IngestionQueueMessage): Promise<void>;
}
