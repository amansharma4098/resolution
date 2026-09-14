import type { AnyCapability, MapServerContext, MapServerProvider } from "./types";

/**
 * The one place every caller resolves "the Capability object for this key" — used in place
 * of a raw `provider.capabilities.find(c => c.key === key)` wherever that lookup needs to
 * also work for a provider with a dynamic capability set (see types.ts's
 * `discoverCapabilities` comment). For every existing provider (Fabric, the Phase 10 mocks)
 * this is exactly equivalent to the raw `.find()` it replaces — the dynamic branch only
 * runs for a provider that actually declares `discoverCapabilities`, so this changes
 * nothing about how any hand-built provider behaves.
 *
 * Deliberately not caching the discovered set across calls: a single incident's
 * investigation/remediation run makes only a handful of capability calls, so the extra
 * round trip to the MCP server (or whatever future provider needs this) per lookup is a
 * fine trade for always reflecting that server's current tools rather than a possibly-stale
 * cache. A longer-lived cache belongs to whichever caller actually needs one (e.g. a UI
 * screen listing capabilities across many calls), not baked in here.
 */
export async function resolveCapability(
  provider: MapServerProvider,
  ctx: MapServerContext,
  key: string,
): Promise<AnyCapability | undefined> {
  const staticMatch = provider.capabilities.find((c) => c.key === key);
  if (staticMatch) return staticMatch;
  if (!provider.discoverCapabilities) return undefined;

  const discovered = await provider.discoverCapabilities(ctx);
  return discovered.find((c) => c.key === key);
}
