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
 * How a mutating capability's real-world effect gets re-checked after execution —
 * ARCHITECTURE.md §6's Verification Agent ("never trusts an HTTP 200 alone"). Optional and
 * provider-specific on purpose: what "verified" means for a Fabric pipeline retry (poll the
 * job instance it started until it's no longer running) is domain knowledge that belongs in
 * the Fabric provider, not hardcoded generically in packages/agents' verification runner —
 * that runner only knows how to call whatever `capabilityKey` + `buildInput` + `classify`
 * says, the same way the investigation/resolution loops only know how to call whatever
 * capability a Map Server exposes.
 */
export interface VerificationSpec<Input = unknown, Output = unknown> {
  /** A read-only capability (on the same Map Server) that re-reads real state. */
  capabilityKey: string;
  /** Builds that capability's input from the mutating call's own input and output — e.g.
   *  combining the pipeline id it was called with and the run id it started. */
  buildInput: (mutatingInput: Input, mutatingOutput: Output) => unknown;
  /** Classifies the read capability's result: PASSED (confirmed successful — done),
   *  FAILED (confirmed failed — no point retrying), or RETRYING (not resolved yet, check
   *  again). Never LLM-driven — see this file's header note and ARCHITECTURE.md §6. */
  classify: (verifyOutput: unknown) => "PASSED" | "FAILED" | "RETRYING";
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
  /** Only meaningful when `mutating: true` — how Phase 8's Verification step re-checks this
   *  action's real-world effect. A mutating capability with no `verification` is executed
   *  but never automatically verified; its RemediationAction is left PASSED-unconfirmed
   *  (see packages/agents/src/remediation's verification runner) rather than the platform
   *  guessing at a check that doesn't exist. */
  verification?: VerificationSpec<Input, Output>;
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
