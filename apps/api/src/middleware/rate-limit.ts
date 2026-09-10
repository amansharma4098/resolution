import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * Best-effort, per-isolate rate limiting — a plain in-memory sliding window keyed by
 * client IP. This is an honest limitation, not an oversight: a Cloudflare Worker can run
 * many isolates across the edge simultaneously, so this map is NOT shared globally the way
 * a single-process Fastify server's would have been — a client could see a higher
 * effective limit than `max` if requests land on different isolates. Real production rate
 * limiting on Workers belongs in Cloudflare's dashboard-configured Rate Limiting Rules (WAF
 * level) or a Durable Object keyed by IP/org; tracked for Phase 12 (production hardening).
 * This still catches basic single-isolate abuse and keeps the shape identical to what a
 * proper limiter would look like.
 */
export function rateLimit(opts: { max: number; windowMs: number }): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, number[]>();

  return async (c, next) => {
    const key =
      c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const windowStart = now - opts.windowMs;
    const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= opts.max) {
      const requestId = c.get("requestId");
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests", requestId } },
        429,
      );
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    await next();
  };
}
