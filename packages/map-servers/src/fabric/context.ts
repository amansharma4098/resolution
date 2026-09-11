import type { MapServerContext } from "../types";
import { FabricClient, getFabricAccessToken } from "./client";

/**
 * Every capability's execute() calls this first — it's the one place a decrypted
 * SERVICE_PRINCIPAL credential (tenantId/clientId/clientSecret, set on
 * MapServerContext.credential only inside the provider's own process — ARCHITECTURE.md §4)
 * turns into an authenticated FabricClient. A fresh token is fetched per call rather than
 * cached across calls within an investigation — a reasonable simplification for now, worth
 * revisiting once Phase 7's agent makes enough sequential calls per incident for token
 * reuse to matter.
 */
export async function fabricClientFromContext(ctx: MapServerContext): Promise<FabricClient> {
  const { tenantId, clientId, clientSecret } = ctx.credential;
  if (typeof tenantId !== "string" || typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new Error(
      "Fabric requires a SERVICE_PRINCIPAL credential with tenantId, clientId, and clientSecret",
    );
  }
  const accessToken = await getFabricAccessToken({ tenantId, clientId, clientSecret });
  return new FabricClient(accessToken);
}
