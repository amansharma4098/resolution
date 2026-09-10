import type { D1Database } from "@cloudflare/workers-types";
import { createD1Client } from "@resolution/database";
import { buildApp } from "./app";
import { loadEnv } from "./env";

/**
 * The Cloudflare Worker bindings for this app — configured in wrangler.toml. `DB` is the
 * D1 database binding (see docs/deployment.md); everything else is a plain string var/
 * secret validated by env.ts's schema.
 */
export interface WorkerEnv {
  DB: D1Database;
  NODE_ENV?: string;
  JWT_SECRET?: string;
  CORS_ORIGIN?: string;
  MOCK_MODE?: string;
  SECRET_PROVIDER?: string;
  ENCRYPTION_MASTER_KEY?: string;
}

export default {
  async fetch(request: Request, workerEnv: WorkerEnv): Promise<Response> {
    const env = loadEnv({
      NODE_ENV: workerEnv.NODE_ENV,
      JWT_SECRET: workerEnv.JWT_SECRET,
      CORS_ORIGIN: workerEnv.CORS_ORIGIN,
      MOCK_MODE: workerEnv.MOCK_MODE,
      SECRET_PROVIDER: workerEnv.SECRET_PROVIDER,
      ENCRYPTION_MASTER_KEY: workerEnv.ENCRYPTION_MASTER_KEY,
    });
    // A fresh PrismaClient/app per request is deliberate, not an oversight — see
    // packages/database/src/d1-client.ts's comment on why this isn't a cached singleton
    // the way the Node dev client is.
    const db = createD1Client(workerEnv.DB);
    const app = buildApp({ db, env });
    return app.fetch(request, workerEnv);
  },
};
