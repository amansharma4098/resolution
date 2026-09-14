import type { MapServerContext } from "../types";
import { DatadogClient } from "./client";

/**
 * Every capability's execute() calls this first — same role as fabric/context.ts's
 * fabricClientFromContext. Datadog's auth is two API keys (DD-API-KEY + DD-APPLICATION-KEY),
 * which doesn't fit any of the single-secret AuthenticationTypes (TOKEN/API_KEY) — CUSTOM's
 * free-form field map is the right fit (see credential-payload.ts's CUSTOM schema), by
 * convention keyed `apiKey`/`applicationKey`.
 */
export function datadogClientFromContext(ctx: MapServerContext): DatadogClient {
  const { apiKey, applicationKey } = ctx.credential;
  if (typeof apiKey !== "string" || typeof applicationKey !== "string") {
    throw new Error("Datadog requires a CUSTOM credential with apiKey and applicationKey fields");
  }
  const site = typeof ctx.config.site === "string" && ctx.config.site.length > 0 ? ctx.config.site : "datadoghq.com";
  return new DatadogClient(site, { apiKey, applicationKey });
}
