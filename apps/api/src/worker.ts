import type { D1Database, MessageBatch, Queue } from "@cloudflare/workers-types";
import { createD1Client } from "@resolution/database";
import { fabricProvider, isMapServerTypeAvailable, registerMapServer } from "@resolution/map-servers";
import { createSecretProvider } from "@resolution/credentials";
import { buildApp } from "./app";
import { loadEnv } from "./env";
import { processIngestionMessage } from "./queue/consumer";
import { processInvestigationMessage } from "./queue/investigation-consumer";
import type { IngestionQueueMessage, InvestigationQueueMessage } from "./queue/types";

// Registers real Map Server providers once per Worker isolate (module-level code runs on
// cold start, then the isolate is reused across requests) — never inside the fetch handler
// below, which would try to register on every request and throw on the second one. Kept
// out of packages/map-servers' own index.ts on purpose: apps/api's tests import buildApp
// directly and expect an empty registry unless a test explicitly registers a fixture — see
// registry.ts's header comment.
if (!isMapServerTypeAvailable("FABRIC")) {
  registerMapServer(fabricProvider);
}

/**
 * The Cloudflare Worker bindings for this app — configured in wrangler.toml. `DB` is the
 * D1 database binding; `INCIDENT_INGESTION_QUEUE` and `INCIDENT_INVESTIGATION_QUEUE` are
 * the producer sides of the two queues this Worker also consumes (see docs/deployment.md);
 * everything else is a plain string var/secret validated by env.ts's schema.
 */
export interface WorkerEnv {
  DB: D1Database;
  INCIDENT_INGESTION_QUEUE: Queue<IngestionQueueMessage>;
  INCIDENT_INVESTIGATION_QUEUE: Queue<InvestigationQueueMessage>;
  NODE_ENV?: string;
  JWT_SECRET?: string;
  CORS_ORIGIN?: string;
  MOCK_MODE?: string;
  SECRET_PROVIDER?: string;
  ENCRYPTION_MASTER_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

function loadWorkerEnv(workerEnv: WorkerEnv) {
  return loadEnv({
    NODE_ENV: workerEnv.NODE_ENV,
    JWT_SECRET: workerEnv.JWT_SECRET,
    CORS_ORIGIN: workerEnv.CORS_ORIGIN,
    MOCK_MODE: workerEnv.MOCK_MODE,
    SECRET_PROVIDER: workerEnv.SECRET_PROVIDER,
    ENCRYPTION_MASTER_KEY: workerEnv.ENCRYPTION_MASTER_KEY,
    ANTHROPIC_API_KEY: workerEnv.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: workerEnv.ANTHROPIC_MODEL,
  });
}

export default {
  async fetch(request: Request, workerEnv: WorkerEnv): Promise<Response> {
    const env = loadWorkerEnv(workerEnv);
    // A fresh PrismaClient/app per request is deliberate, not an oversight — see
    // packages/database/src/d1-client.ts's comment on why this isn't a cached singleton
    // the way the Node dev client is.
    const db = createD1Client(workerEnv.DB);
    const app = buildApp({
      db,
      env,
      incidentIngestionQueue: {
        send: async (message) => {
          await workerEnv.INCIDENT_INGESTION_QUEUE.send(message);
        },
      },
      incidentInvestigationQueue: {
        send: async (message) => {
          await workerEnv.INCIDENT_INVESTIGATION_QUEUE.send(message);
        },
      },
    });
    return app.fetch(request, workerEnv);
  },

  /**
   * The consumer side of both queues — ARCHITECTURE.md §10's "all heavy work runs async off
   * the queue". One Worker script, one `queue` export: Cloudflare invokes it for every queue
   * consumer binding configured in wrangler.toml, distinguishing them via `batch.queue` — so
   * this dispatches rather than needing a second deployment. Cloudflare Queues deliver
   * at-least-once and batch messages; each message is acked individually so one bad message
   * in a batch doesn't cause the whole batch to retry. A message that keeps failing exhausts
   * `max_retries` (wrangler.toml) and lands on that queue's dead-letter queue rather than
   * retrying forever.
   */
  async queue(
    batch: MessageBatch<IngestionQueueMessage> | MessageBatch<InvestigationQueueMessage>,
    workerEnv: WorkerEnv,
  ): Promise<void> {
    const db = createD1Client(workerEnv.DB);

    if (batch.queue.includes("investigation")) {
      const env = loadWorkerEnv(workerEnv);
      const config = {
        mockMode: env.MOCK_MODE,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        anthropicModel: env.ANTHROPIC_MODEL,
        secretProvider: createSecretProvider(env.SECRET_PROVIDER, { masterKey: env.ENCRYPTION_MASTER_KEY }),
      };
      for (const message of batch.messages as MessageBatch<InvestigationQueueMessage>["messages"]) {
        try {
          await processInvestigationMessage(db, config, message.body);
          message.ack();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Incident investigation failed, will retry:", err);
          message.retry();
        }
      }
      return;
    }

    for (const message of batch.messages as MessageBatch<IngestionQueueMessage>["messages"]) {
      try {
        await processIngestionMessage(db, message.body, {
          onIncidentCreated: async (evt) => {
            await workerEnv.INCIDENT_INVESTIGATION_QUEUE.send(evt);
          },
        });
        message.ack();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Incident ingestion failed, will retry:", err);
        message.retry();
      }
    }
  },
};
