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

/** Enqueued once, right after a NEW incident is created (see consumer.ts's
 *  `onIncidentCreated` hook) — never re-enqueued for a redelivered ingestion message, since
 *  that hook only fires on the branch that actually inserted a new Incident row. */
export interface InvestigationQueueMessage {
  incidentId: string;
  organizationId: string;
}

/** Same producer/consumer decoupling as IncidentIngestionQueue, for the investigation
 *  queue — see investigation-consumer.ts (real work) and inline-investigation-queue.ts
 *  (tests/local dev synchronous stand-in). */
export interface IncidentInvestigationQueue {
  send(message: InvestigationQueueMessage): Promise<void>;
}

/** Enqueued once per successful RCA_COMPLETE (see investigation-consumer.ts's
 *  `onRcaCompleted` hook). One message drives the whole propose → policy-gate →
 *  (execute + verify, if AUTO) pipeline in a single consumer invocation — see
 *  remediation-consumer.ts's header comment for why this isn't split into more queues. */
export interface RemediationQueueMessage {
  incidentId: string;
  organizationId: string;
}

/** Same producer/consumer decoupling as the other two queues — see remediation-consumer.ts
 *  (real work) and inline-remediation-queue.ts (tests/local dev synchronous stand-in). */
export interface IncidentRemediationQueue {
  send(message: RemediationQueueMessage): Promise<void>;
}
