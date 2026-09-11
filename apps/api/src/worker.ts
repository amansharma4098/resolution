import type { D1Database, MessageBatch, Queue } from "@cloudflare/workers-types";
import { createD1Client } from "@resolution/database";
import { fabricProvider, isMapServerTypeAvailable, registerMapServer } from "@resolution/map-servers";
import { buildApp } from "./app";
import { loadEnv } from "./env";
import { processIngestionMessage } from "./queue/consumer";
import type { IngestionQueueMessage } from "./queue/types";

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
 * D1 database binding, `INCIDENT_INGESTION_QUEUE` the producer side of the queue
 * webhooks.ts enqueues onto (see docs/deployment.md); everything else is a plain string
 * var/secret validated by env.ts's schema.
 */
export interface WorkerEnv {
  DB: D1Database;
  INCIDENT_INGESTION_QUEUE: Queue<IngestionQueueMessage>;
  NODE_ENV?: string;
  JWT_SECRET?: string;
  CORS_ORIGIN?: string;
  MOCK_MODE?: string;
  SECRET_PROVIDER?: string;
  ENCRYPTION_MASTER_KEY?: string;
}

function loadWorkerEnv(workerEnv: WorkerEnv) {
  return loadEnv({
    NODE_ENV: workerEnv.NODE_ENV,
    JWT_SECRET: workerEnv.JWT_SECRET,
    CORS_ORIGIN: workerEnv.CORS_ORIGIN,
    MOCK_MODE: workerEnv.MOCK_MODE,
    SECRET_PROVIDER: workerEnv.SECRET_PROVIDER,
    ENCRYPTION_MASTER_KEY: workerEnv.ENCRYPTION_MASTER_KEY,
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
    });
    return app.fetch(request, workerEnv);
  },

  /**
   * The consumer side of the queue — ARCHITECTURE.md §10's "all heavy work runs async off
   * the queue". Cloudflare Queues deliver at-least-once and batch messages; each message is
   * acked individually so one bad message in a batch doesn't cause the whole batch to
   * retry. A message that keeps failing exhausts `max_retries` (wrangler.toml) and lands on
   * the dead-letter queue rather than retrying forever.
   */
  async queue(batch: MessageBatch<IngestionQueueMessage>, workerEnv: WorkerEnv): Promise<void> {
    const db = createD1Client(workerEnv.DB);
    for (const message of batch.messages) {
      try {
        await processIngestionMessage(db, message.body);
        message.ack();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Incident ingestion failed, will retry:", err);
        message.retry();
      }
    }
  },
};
