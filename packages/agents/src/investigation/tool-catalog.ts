import { zodToToolSchema, type LlmToolSpec } from "@resolution/ai";
import type { AnyCapability, MapServerType } from "@resolution/map-servers";

export interface AvailableCapability {
  mapServerId: string;
  mapServerType: MapServerType;
  capability: AnyCapability;
}

// A capability `key` alone is ambiguous once an org has more than one Map Server of the
// same type (two Fabric workspaces, say) — the tool name the model sees has to identify
// exactly which Map Server instance a call runs against.
const TOOL_NAME_SEPARATOR = "__";

export function toolNameFor(mapServerId: string, capabilityKey: string): string {
  return `${mapServerId}${TOOL_NAME_SEPARATOR}${capabilityKey}`;
}

/** Builds the Claude tool list for one investigation run — one entry per capability the org
 *  has explicitly enabled (investigation-consumer.ts already filtered this to read-only,
 *  `mutating: false` capabilities before calling here; mutating capabilities belong to
 *  Phase 8's remediation flow, never to investigation). */
export function buildCapabilityToolSpecs(available: AvailableCapability[]): LlmToolSpec[] {
  return available.map(({ mapServerId, capability }) => ({
    name: toolNameFor(mapServerId, capability.key),
    description: capability.description,
    input_schema: zodToToolSchema(capability.inputSchema) as LlmToolSpec["input_schema"],
  }));
}
