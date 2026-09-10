import type { z, ZodSchema } from "zod";
import type { MapServerType } from "@resolution/shared";

export type { MapServerType };

export type ConnectionStatus = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";

export type AuthenticationType =
  | "OAUTH"
  | "API_KEY"
  | "CLIENT_SECRET"
  | "SERVICE_PRINCIPAL"
  | "BASIC_AUTH"
  | "TOKEN"
  | "CUSTOM";

/**
 * Everything a capability's execute() needs, and nothing more — ARCHITECTURE.md §4. The
 * agent never sees a decrypted credential directly; it only ever calls a capability with
 * this context, and only the Map Server's own client code (inside execute()) touches
 * `credential`.
 */
export interface MapServerContext {
  organizationId: string;
  mapServerId: string;
  environment: string;
  credential: Record<string, unknown>;
  requestId: string;
}

/**
 * One typed, schema-validated action a Map Server exposes. The agent (and apps/api's
 * test/manual-invoke paths) call `execute` only after validating `input` against
 * `inputSchema` and the result against `outputSchema` — never with a raw/untyped payload.
 */
export interface Capability<Input = unknown, Output = unknown> {
  key: string;
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  inputSchema: ZodSchema<Input>;
  outputSchema: ZodSchema<Output>;
  /** Subject to AutomationPolicy gating (ARCHITECTURE.md §7). Read-only capabilities
   *  (mutating: false) always run during investigation regardless of resolution mode. */
  mutating: boolean;
  execute: (ctx: MapServerContext, input: Input) => Promise<Output>;
}

export interface ConnectionTestResult {
  status: ConnectionStatus;
  detail?: string;
}

export interface MapServerProvider {
  type: MapServerType;
  metadata: {
    displayName: string;
    docsUrl?: string;
    /** True for a provider built to the MVP mock scope — surfaced as the `MOCK` badge in
     *  the UI, never disguised as production-ready. */
    isMock: boolean;
  };
  configSchema: ZodSchema;
  authAdapter: {
    authenticationTypes: AuthenticationType[];
    testConnection: (ctx: MapServerContext) => Promise<ConnectionTestResult>;
  };
  capabilities: Capability[];
  healthCheck: (ctx: MapServerContext) => Promise<ConnectionTestResult>;
}

export type AnyCapability = Capability<unknown, unknown>;
export type InferCapabilityInput<C> = C extends Capability<infer I, unknown> ? I : never;
export type InferCapabilityOutput<C> = C extends Capability<unknown, infer O> ? O : never;

// Re-exported so provider folders can build schemas without importing zod's z type name twice.
export type { z };
