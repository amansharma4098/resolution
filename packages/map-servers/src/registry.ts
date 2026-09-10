import { MapServerType as MapServerTypeSchema } from "@resolution/shared";
import type { MapServerProvider, MapServerType } from "./types";

/**
 * The single place providers register themselves — ARCHITECTURE.md §4 / docs/map-server.md.
 * Adding a provider is exactly one line here (`registerMapServer(fooProvider)`), executed
 * as a side effect of importing its folder; nothing else in this package, the orchestrator,
 * or apps/api changes. Deliberately starts empty: FABRIC lands in Phase 5, the mock
 * providers in Phase 10 (see IMPLEMENTATION_PLAN.md) — a MapServerType existing in the
 * shared enum does not imply a provider is registered yet.
 */
const registry = new Map<MapServerType, MapServerProvider>();

export function registerMapServer(provider: MapServerProvider): void {
  if (registry.has(provider.type)) {
    throw new Error(`A Map Server provider is already registered for type "${provider.type}"`);
  }
  registry.set(provider.type, provider);
}

export function getMapServerProvider(type: MapServerType): MapServerProvider | undefined {
  return registry.get(type);
}

export function isMapServerTypeAvailable(type: MapServerType): boolean {
  return registry.has(type);
}

export interface MapServerCatalogEntry {
  type: MapServerType;
  available: boolean;
  displayName: string;
  isMock: boolean;
  capabilityCount: number;
}

/** Every MapServerType the platform's data model knows about, each flagged with whether a
 *  provider is actually registered yet — this is what powers the "select type" step of the
 *  config wizard (apps/web/app/dashboard/map-servers), so an org can see and even start
 *  configuring a not-yet-available provider without the UI pretending it's connected. */
export function getMapServerCatalog(): MapServerCatalogEntry[] {
  return MapServerTypeSchema.options.map((type) => {
    const provider = registry.get(type);
    return {
      type,
      available: provider !== undefined,
      displayName: provider?.metadata.displayName ?? type,
      isMock: provider?.metadata.isMock ?? false,
      capabilityCount: provider?.capabilities.length ?? 0,
    };
  });
}

/** Test-only: clears every registered provider. Never call outside a test teardown — the
 *  real registry is process-lifetime, populated once at boot by each provider's import. */
export function __resetRegistryForTests(): void {
  registry.clear();
}
