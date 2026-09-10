# Adding a new Map Server

A Map Server is the only way the AI agent touches a customer's technical systems. It never
makes arbitrary API calls or runs a raw command string — every action is a typed capability
validated by a Zod schema, both on the way in and on the way out. Adding a provider **never
requires touching the orchestrator, the agent code, or any other provider's folder.**

## The seven pieces

Create `packages/map-servers/<provider>/` with:

1. **`metadata.ts`** — display name, docs link, and an `isMock` flag. A provider built for
   the MVP mock scope (§10 of the original spec) sets `isMock: true`; the UI reads this flag
   to render the `MOCK` badge — never hand-wave a mock as production-ready in copy or code.
2. **`auth.ts`** — the auth adapter: which `AuthenticationType`(s) this provider accepts
   (`OAUTH | API_KEY | CLIENT_SECRET | SERVICE_PRINCIPAL | BASIC_AUTH | TOKEN | CUSTOM`) and
   a `testConnection(ctx)` used by "Test connection" in the UI and by `/api/map-servers/:id/test`.
3. **`capabilities/*.ts`** — one file per capability. Each exports a `Capability<Input,
   Output>` (see ARCHITECTURE.md §4): a `key`, `riskLevel`, `mutating` flag, an
   `inputSchema`/`outputSchema` (Zod), and `execute(ctx, input)`. `mutating: true`
   capabilities are the only ones subject to `AutomationPolicy` gating — read-only
   capabilities always run during investigation regardless of resolution mode.
4. **`client.ts`** — the thin SDK/HTTP wrapper the capabilities call into. Credentials reach
   this client already decrypted by `MapServerContext.credential` — it must never log them,
   never persist them outside the request, and never return them in any capability output.
5. **`healthCheck.ts`** — returns `{ status: ConnectionStatus, detail? }`, polled to keep
   `MapServer.status` current on the Map Servers screen.
6. **`config.schema.ts`** — a Zod schema for the org-entered config (workspace id, region,
   cluster name, instance URL, …). Rendered automatically by the generic config-wizard UI —
   a new provider does not need a new wizard screen.
7. **`<provider>.test.ts`** — unit tests for capabilities (input/output schema round-trips)
   and the health check, using a faked client.

## Registration

```typescript
// packages/map-servers/registry.ts
import { fabricProvider } from "./fabric";
import { databricksProvider } from "./databricks";
// ...

export const mapServerRegistry: Record<MapServerType, MapServerProvider> = {
  FABRIC: fabricProvider,
  DATABRICKS: databricksProvider,
  // ...
};
```

That one-line addition to the registry map is the **only** change outside the provider's
own folder. The orchestrator (`packages/agents/orchestrator.ts`) and every agent resolve
capabilities exclusively through `mapServerRegistry[org's MapServer.type]` — they hold no
provider-specific branches.

## What the agent is allowed to call

At runtime, for a given org and affected system:

1. Look up the org's `MapServer` row for that `MapServerType` (never a hardcoded provider).
2. Look up its `MapServerCapability` rows where `enabled = true`.
3. Intersect with `mapServerRegistry[type].capabilities` by `key`.
4. Only that intersection is ever exposed to the LLM's tool-calling loop for this
   investigation. A capability the org has not explicitly enabled is invisible to the
   agent, not merely "policy-denied" — this is enforced before the LLM ever sees a tool
   definition, not after.

## Mock providers

A mock provider implements the exact same `MapServerProvider` interface with `isMock:
true` and capability `execute` functions that return realistic, schema-valid canned/
simulated data (optionally seeded/randomized for demo variety) instead of calling a real
API. This is how `MOCK_MODE=true` runs the full incident lifecycle with zero production
credentials (ARCHITECTURE.md §13) — the orchestrator cannot tell a mock provider from a
real one; only the `isMock` flag surfaces to the UI as the `MOCK` badge.

## Real Map Servers in the MVP

Only **Fabric** is real end-to-end in the MVP. Its capabilities: `get_workspace`,
`get_pipeline`, `get_pipeline_run`, `get_logs`, `retry_pipeline` (the only mutating one —
`riskLevel: LOW`, default policy `AUTO` per the spec's risk table, still overridable per
org). See `packages/map-servers/fabric/` (Phase 5).
