import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** The sliding-window hit log a `rateLimit` middleware reads/writes, keyed by client IP.
 *  Create one with `createRateLimitStore()` and share it across every request the store
 *  should apply to — see this file's header comment on why that sharing has to happen
 *  outside `buildApp`. */
export type RateLimitStore = Map<string, number[]>;

export function createRateLimitStore(): RateLimitStore {
  return new Map();
}

/**
 * Best-effort, per-isolate rate limiting — a plain in-memory sliding window keyed by
 * client IP. This is an honest limitation, not an oversight: a Cloudflare Worker can run
 * many isolates across the edge simultaneously, so a store here is NOT shared globally the
 * way a single-process Fastify server's would have been — a client could see a higher
 * effective limit than `max` if requests land on different isolates. Real production rate
 * limiting on Workers belongs in Cloudflare's dashboard-configured Rate Limiting Rules (WAF
 * level) or a Durable Object keyed by IP/org; tracked for Phase 12 (production hardening).
 * This still catches basic single-isolate abuse and keeps the shape identical to what a
 * proper limiter would look like.
 *
 * The store is a required argument, not created inside this function, because `buildApp`
 * (and therefore every `rateLimit(...)` call inside it) runs fresh on every request in
 * production — see worker.ts's `fetch` handler. A store created in here would be thrown
 * away before the next request ever saw it, silently limiting nothing. worker.ts hoists its
 * stores to module scope, outside `fetch`, so they actually persist across the many
 * requests one isolate serves; tests/local dev get a fresh store per `buildApp` call
 * instead, which is exactly the isolation they want between runs.
 */
export function rateLimit(
  store: RateLimitStore,
  opts: { max: number; windowMs: number },
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key =
      c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const windowStart = now - opts.windowMs;
    const timestamps = (store.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= opts.max) {
      const requestId = c.get("requestId");
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests", requestId } },
        429,
      );
    }

    timestamps.push(now);
    store.set(key, timestamps);
    await next();
  };
}
