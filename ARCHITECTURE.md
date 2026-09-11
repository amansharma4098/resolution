# Architecture — AI Incident Resolution Platform

Status: living document, updated as phases land. See `IMPLEMENTATION_PLAN.md` for the
build sequence and current phase status.

## 1. System overview

A multi-tenant SaaS platform where an AI agent investigates, diagnoses, remediates and
verifies production incidents by calling into a customer's own ITSM, monitoring, cloud,
data and infrastructure systems through a strictly typed **Map Server** abstraction. No
vendor (including Microsoft Fabric) is hard-coded into the core engine.

```
Incident Source (Jira/ServiceNow/PagerDuty/webhook)
        │  normalized incident
        ▼
Incident Orchestrator ── Investigation Agent ── Map Servers (typed capabilities only)
        │                 Knowledge Agent ────── pgvector, org-scoped
        │                 Context Agent
        ▼
   RCA Agent → Resolution Agent → Policy Engine (code, not LLM) → Approval (if required)
        → Remediation Agent → Verification Agent (checks real system state)
        → Incident Update Agent (writes back to source)
```

## 2. Hosting topology (Cloudflare-only)

Everything runs on Cloudflare's own products — no Neon/Upstash/Railway/Render. This is a
deliberate pivot from an earlier "hybrid" decision (Postgres/Redis on a Node host): the
spec's literal Postgres+pgvector+Redis+BullMQ stack doesn't run on Cloudflare, so instead
of hosting *that* stack elsewhere, the stack itself was ported onto Cloudflare's native
primitives — D1 instead of Postgres, Web Crypto instead of Node's `node:crypto`, Cloudflare
Queues instead of BullMQ+Redis (Phase 6, not yet built), Vectorize instead of pgvector
(Phase 7, not yet built).

| Concern | Provider | Why |
|---|---|---|
| Frontend (`apps/web`, Next.js static export) | Cloudflare Pages | Git-connected — auto-deploys on every push to `main` |
| API (`apps/api`, Hono) | Cloudflare Workers | request/response `fetch` model, no persistent process needed |
| Primary DB | Cloudflare D1 (SQLite) | Workers' native DB binding; no native enum/JSON column types, handled at the schema/repository layer (§8) |
| Static/blob assets, uploaded docs | Cloudflare R2 | S3-compatible, cheap egress |
| Background jobs (Phase 6+) | Cloudflare Queues | Workers can't run long-lived BullMQ consumers |
| Vector search (Phase 7+) | Cloudflare Vectorize | D1/SQLite has no vector column type |
| DNS / edge routing | Cloudflare | already the registrar/DNS target |
| Secrets (prod) | `wrangler secret put` — encrypted server-side, never in `wrangler.toml` or committed | `JWT_SECRET`, `ENCRYPTION_MASTER_KEY` |

Local dev: `wrangler dev` emulates the whole Workers + D1 runtime locally (via Miniflare) —
zero cloud accounts needed to develop. `packages/database`'s Prisma schema also works
against a plain local `file:` SQLite URL with no adapter for quick Node-side testing (see
`packages/database/src/d1-client.ts`'s header comment on why the deployed Worker still
needs the D1 driver adapter and a plain Node process doesn't).

The Cloudflare API token provided is stored only in the untracked `.env` (see
`.env.example` for the shape) and used to provision Pages/R2/D1/Workers via the Cloudflare
API and `wrangler` — never committed, never logged.

**Known platform gaps, worked around deliberately (not bugs):**
- Prisma's *interactive* `$transaction(async (tx) => ...)` isn't supported on D1 — only
  the batch array form (`$transaction([...])`). `OrganizationRepository.createWithOwner`
  pre-generates the org's UUID client-side so both inserts can go in one batch call.
- D1/SQLite has no native `enum` or `Json` column type — every enum field in
  `schema.prisma` is a `String` (see §8), and every JSON field is stored as serialized text
  via `packages/database/src/json-field.ts`, parsed back on every read.
- The session cookie's `SameSite` must be `None` (not `Lax`) in production — Pages
  (`*.pages.dev`) and the Worker (`*.workers.dev`) are different sites, so a `Lax` cookie
  would never be sent on the frontend's cross-origin `fetch` calls. See
  `packages/security/src/session.ts`.

## 3. Monorepo layout

```
apps/
  web/       Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui — deployed to CF Pages
  api/       Hono HTTP API + Cloudflare Queue consumers, one Worker (see below)
packages/
  database/    Prisma schema + generated client + repositories (tenant-scoped access only)
  ai/          LLM client, prompt templates, RCA/hypothesis engine, embeddings
  agents/      IncidentStatus state machine (Phase 6, real); the orchestrator +
               Investigation/Knowledge/Context/RCA/Resolution/Remediation/Verification/
               IncidentUpdate agents land here in Phase 7-8
  integrations/  Incident-source adapters — jira/, servicenow/ real; pagerduty/, webhook/ later
  map-servers/   One folder per provider implementing the MapServer interface (§4) —
                 fabric/ real (Phase 5); others land per IMPLEMENTATION_PLAN.md
  credentials/   SecretProvider abstraction + encryption
  security/      RBAC, tenant-context middleware, audit logging, rate limiting
  shared/        Zod schemas, shared types, normalized Incident shape, constants
  ui/            design-tokens.ts, shared React components (StatusBadge, IntegrationCard, …)
```

No separate `apps/worker` — a Cloudflare Worker script can export both a `fetch` handler
(HTTP) and a `queue` handler (Cloudflare Queue consumer) from the same deployment
(`apps/api/src/worker.ts`), and Workers are cheap/serverless enough that splitting them
across two deployments buys nothing the way it would for independently-scaled Node
processes. Every named queue's consumer lives in `apps/api/src/queue/`.

## 4. Map Server interface (core architectural principle)

The agent NEVER makes arbitrary API calls and NEVER executes a raw command string. Every
action is a typed capability call validated against a Zod schema before and after
execution.

```typescript
// packages/map-servers/src/types.ts
export type MapServerType =
  | "FABRIC" | "DATABRICKS" | "SNOWFLAKE" | "AZURE" | "AWS" | "GCP"
  | "KUBERNETES" | "DATADOG" | "SPLUNK" | "DYNATRACE" | "NEW_RELIC"
  | "AIRFLOW" | "CUSTOM";

export type ConnectionStatus = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";

export interface Capability<Input = unknown, Output = unknown> {
  key: string;                 // e.g. "get_pipeline_run", "retry_pipeline"
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  inputSchema: ZodSchema<Input>;
  outputSchema: ZodSchema<Output>;
  mutating: boolean;            // true => subject to AutomationPolicy gating
  execute: (ctx: MapServerContext, input: Input) => Promise<Output>;
}

export interface MapServerContext {
  organizationId: string;
  mapServerId: string;
  environment: string;
  credential: ResolvedCredential;   // decrypted only inside the provider's own process, never returned
  requestId: string;
}

export interface MapServerProvider {
  type: MapServerType;
  metadata: { displayName: string; docsUrl?: string; isMock: boolean };
  configSchema: ZodSchema;          // environment/workspace config the org fills in
  authAdapter: {
    authenticationTypes: AuthenticationType[];
    testConnection: (ctx: MapServerContext) => Promise<ConnectionTestResult>;
  };
  capabilities: Capability[];
  healthCheck: (ctx: MapServerContext) => Promise<{ status: ConnectionStatus; detail?: string }>;
}
```

**Adding a new Map Server never touches the orchestrator.** It requires, in one new folder
under `packages/map-servers/<provider>/`:

1. `metadata.ts` — provider metadata (`isMock` flag if not real yet)
2. `auth.ts` — auth adapter (maps to one or more `AuthenticationType`s)
3. `capabilities/*.ts` — one file per capability, each a typed `Capability`
4. `client.ts` — thin SDK/HTTP client used by capabilities
5. `healthCheck.ts`
6. `config.schema.ts` — Zod schema for org-entered config (workspace id, region, cluster, …)
7. `<provider>.test.ts`

The provider self-registers into a `MapServerRegistry` (`packages/map-servers/src/registry.ts`)
read by the orchestrator at runtime — the orchestrator only ever asks the registry "which
capabilities does this org's Map Server for this system expose" and calls through it. Full
walkthrough: `docs/map-server.md`.

## 5. Credential architecture

```
Credential {
  id, organizationId, name, provider, authenticationType,
  encryptedData, createdAt, updatedAt, lastValidatedAt, status
}
```

- `authenticationType`: `OAUTH | API_KEY | CLIENT_SECRET | SERVICE_PRINCIPAL | BASIC_AUTH | TOKEN | CUSTOM`
- Created once per org, then referenced by `credentialId` from any number of Map Servers —
  never re-entered.
- `encryptedData` is envelope-encrypted (AES-256-GCM, per-org data key wrapped by a root
  key from the `SecretProvider`) and is never sent to the frontend after creation; the API
  only ever returns a masked shape (`{ id, name, provider, authenticationType, status,
  lastValidatedAt, maskedHint: "••••1234" }`).

```typescript
// packages/credentials/src/secret-provider.ts
export interface SecretProvider {
  encrypt(plaintext: Record<string, unknown>, context: { organizationId: string }): Promise<string>;
  decrypt(ciphertext: string, context: { organizationId: string }): Promise<Record<string, unknown>>;
}
```

Rotation is deliberately not a `SecretProvider` method — the provider only knows how to
seal/open a blob, not about `Credential` rows. `/api/credentials/:id/rotate` validates the
new payload, calls `encrypt()` again, and updates the row (resetting `status` to
`UNVERIFIED`) — see `apps/api/src/routes/credentials.ts`.

Implemented: `EncryptedDbSecretProvider` (default — real envelope encryption entirely in
Postgres: a random per-credential data key encrypts the payload, wrapped by a root key from
`ENCRYPTION_MASTER_KEY`, both AES-256-GCM with `organizationId` as AAD so a blob can't be
decrypted under the wrong org's context). Selected via `SECRET_PROVIDER` env var.
`AwsSecretsManagerProvider` / `AzureKeyVaultProvider` / `GcpSecretManagerProvider` are
designed for behind the same interface but not implemented yet (Phase 12 — production
hardening; selecting one via `SECRET_PROVIDER` throws a clear error rather than silently
falling back). See `docs/credentials.md`.

## 6. AI agent architecture

Orchestrator (`packages/agents/orchestrator.ts`) drives a state machine per incident
(`Investigation`, `RootCauseAnalysis`, `Resolution`, `RemediationAction`, `Verification`
rows track each stage). Sub-agents:

| Agent | LLM? | Responsibility |
|---|---|---|
| Investigation Agent | yes (tool-calling) | discovers affected system → looks up org's enabled Map Server → calls only enabled, non-disabled capabilities to gather evidence |
| Knowledge Agent | yes (retrieval + synthesis) | pgvector search over the org's own namespace only (historical incidents, runbooks, docs) |
| Context Agent | yes | pulls incident metadata, service ownership, recent deploys/changes |
| RCA Agent | yes | produces root cause with FACT / INFERENCE / HYPOTHESIS labels, confidence score, cited evidence IDs, alternative hypotheses — never invents evidence, every claim must cite an `IncidentEvidence` row |
| Resolution Agent | yes | proposes a remediation using only capabilities the Map Server exposes |
| **Policy Engine** | **no — plain code** | evaluates `AutomationPolicy` against the proposed action's risk level and the org's resolution mode; decides AUTO / APPROVAL / DENY |
| Remediation Agent | orchestration only | executes the approved mutating capability call |
| Verification Agent | **no — plain code + real system reads** | re-queries real system state via the Map Server before marking resolved; never trusts an HTTP 200 alone; on failure, retries if policy permits, else escalates |
| Incident Update Agent | no | writes status/comments back to the incident source (Jira/ServiceNow) |

Hard rules enforced in code, not by prompting:
- LLM calls never perform policy evaluation, approval gating, or verification checks.
- Every tool call is validated against the capability's Zod schema on input and output.
- The agent only calls capabilities present in the org's `MapServerCapability` enabled set.
- Every RCA claim references an `IncidentEvidence.id`; the API rejects an RCA response that
  cites no evidence for a FACT-labeled statement.
- Resolution is marked `RESOLVED` only after a `Verification` row shows the real system
  state matches the expected post-remediation state.

**Phase 7 reality vs. the table above**: the Investigation Agent and RCA Agent are real and
live (`packages/agents/src/investigation`, `packages/ai`) — a hand-written multi-turn
tool-calling loop against `claude-opus-5` (or a genuine `MOCK_MODE` client, never a stub —
see IMPLEMENTATION_PLAN.md's Phase 7 entry), tools built only from an org's enabled,
non-mutating capabilities, RCA forced through a `submit_rca` tool call whose input is
re-validated against `RootCauseAnalysisOutput`'s own Zod schema (so the "FACT claims must
cite evidence" rule is actually enforced, not just documented in a tool description).
There is no separate orchestrator/Context Agent/Knowledge Agent/Resolution Agent yet — the
Investigation Agent's loop *is* the orchestration for this phase (it decides when to stop
gathering evidence and hands off directly to RCA in the same run), and the Policy
Engine/Remediation/Verification/Incident Update rows below remain Phase 8+ as originally
planned.

## 7. Automation policy

```
AutomationPolicy { id, organizationId, mapServerType, capabilityKey, riskLevel,
  behavior: AUTO | APPROVAL | DENY, resolutionModeFloor, createdAt, updatedAt }
```

Org-level `resolutionMode`: `OBSERVE_ONLY → RECOMMEND → HUMAN_APPROVED → AUTONOMOUS`
(stored on `Organization`). Effective behavior for a given action = the stricter of (a) the
capability's own policy row and (b) what the org's current resolution mode permits — e.g. a
LOW-risk action configured AUTO still requires approval if the org is in `RECOMMEND` mode.
Evaluated entirely in `packages/agents/policy-engine.ts` (pure functions, unit-testable, no
LLM).

## 8. Data model

Cloudflare D1 (SQLite) via Prisma, UUID primary keys, every tenant-owned table carries
`organizationId` with a composite index `(organizationId, createdAt)` or similar per
access pattern. Full schema: `packages/database/prisma/schema.prisma`. Model list:

SQLite has no native `enum` or `Json` column type, so two things differ from a typical
Postgres+Prisma schema:
- Every field that would be a Prisma `enum` (`Role`, `MapServerType`, `IncidentStatus`, …)
  is a plain `String` column, with the allowed values documented in a comment above the
  field and enforced by the corresponding Zod union at the application layer
  (`packages/shared`, `packages/security`, `packages/map-servers`, `packages/credentials`)
  instead of by the database schema.
- Every field that would be `Json` (`config`, `metadata`, `payload`, …) is a `String`
  column storing serialized JSON text, via `packages/database/src/json-field.ts`
  (`serializeJsonField`/`parseJsonField`). Each repository's `toPublic()` mapper parses it
  back before returning to a caller — the raw Prisma row (with a JSON-text string field)
  is never handed to route code directly.

`User, Organization, OrganizationMember, Credential, Integration, MapServer,
MapServerCapability, Incident, IncidentEvent, IncidentEvidence, Investigation,
InvestigationStep, RootCauseAnalysis, Resolution, RemediationAction, Approval,
Verification, KnowledgeDocument, KnowledgeEmbedding, Runbook, RunbookStep,
AutomationPolicy, AuditLog, AgentExecution, WebhookEvent, Notification, UsageMetric,
Subscription`

Normalized incident shape (every source maps into this on ingestion):

```typescript
interface NormalizedIncident {
  id: string; organizationId: string; externalId: string; source: IncidentSource;
  title: string; description: string; severity: Severity; priority: Priority;
  status: IncidentStatus; service?: string; environment?: string; resource?: string;
  affectedSystem?: MapServerType; createdAt: Date; metadata: Record<string, unknown>;
}
```

Tenant isolation: every repository method in `packages/database/repositories/*` takes an
`organizationId` derived from the authenticated session in `apps/api` middleware — it is
never accepted as a client-supplied field, and every Prisma query in a repository has
`where: { organizationId, ... }` enforced by a lint rule / repository base class, not by
convention alone.

## 9. API contracts

Base: `/api/*` on `apps/api` (Hono, deployed as a Cloudflare Worker), JSON, Zod-validated request/response, versioned
error shape `{ error: { code, message, requestId } }`. Full contract per route:
`docs/api.md`. Surface:

```
/api/auth/*
/api/organizations
/api/incidents  /api/incidents/:id
/api/incidents/:id/investigate  /api/incidents/:id/remediate
/api/incidents/:id/approve      /api/incidents/:id/reject
/api/map-servers  /api/map-servers/:id  /api/map-servers/:id/test
/api/credentials  /api/credentials/:id  /api/credentials/:id/test  /api/credentials/:id/rotate
/api/integrations
/api/knowledge
/api/runbooks
/api/policies
/api/audit
/api/webhooks/jira        (HMAC/signature verified, 202 immediately, queued)
/api/webhooks/servicenow  (signature verified, 202 immediately, queued)
```

## 10. Background processing

**Cloudflare Queues**, not Redis+BullMQ — see §2 for why. Named queues:
`incident-ingestion` and `incident-investigation` are real (Phases 6–7 — see below);
`knowledge-retrieval`, `ai-analysis` (folded into `incident-investigation`'s consumer
rather than split out — one agent run does discovery through RCA in one pass, so a separate
queue hop between them would add latency without adding real decoupling), `remediation`,
`verification`, `notification`, `webhook-processing` (for sources beyond Jira/ServiceNow)
remain unbuilt. Each lands alongside the phase that actually consumes it (Phase 8 for
remediation/verification) — creating an empty queue resource with no real consumer ahead of
that would be exactly the kind of placeholder-dressed-as-done this project's own ground
rules warn against.

Webhook HTTP handlers (`apps/api/src/routes/webhooks.ts`) do secret verification + shape
validation only, enqueue via a real Cloudflare Queue producer binding, and return `202`
immediately — all the actual work (idempotency check, normalization, Incident creation)
runs in the same Worker's `queue` export (`apps/api/src/worker.ts`), which is Cloudflare's
consumer entrypoint for that binding (`apps/api/src/queue/consumer.ts`). That same consumer,
on the branch that actually inserts a new `Incident` row, enqueues once onto
`incident-investigation`; its consumer (`apps/api/src/queue/investigation-consumer.ts`) runs
the Investigation/RCA agent (§6) and drives the incident's status through the state machine.
One Worker script still exports a single `queue` handler for both bindings — it dispatches
on `batch.queue`, since Cloudflare invokes the same export for every consumer binding a
Worker has. Cloudflare Queues deliver at-least-once and batch messages; each message is
acked individually so one bad message doesn't retry the whole batch, and a message that
exhausts `max_retries` (`wrangler.toml`) lands on a dead-letter queue rather than retrying
forever or vanishing. `incident-investigation`'s batch size is deliberately small (3, vs.
ingestion's 10) and its retries fewer (2, vs. 3) — each message drives a real, possibly
billed LLM run, not a cheap idempotent insert.

Idempotency: webhook events keyed by `(source, externalId, eventHash)` in `WebhookEvent`;
`Incident` itself is also keyed by `(organizationId, source, externalId)`, so even a
duplicate delivery that somehow got past the `WebhookEvent` check can't create a second
Incident row. Remediation actions (Phase 8) will be keyed by
`(incidentId, capabilityKey, runId)` — a remediation must never be re-executed without
first re-reading real external-system state.

Tests use synchronous inline stand-ins for both queues (`apps/api/src/queue/inline-queue.ts`,
`inline-investigation-queue.ts`) that run the exact same consumer logic, awaited, instead of
real decoupled Cloudflare Queues — documented there as the one behavioral difference from
production (timing, not logic), since Vitest doesn't run under Miniflare's Queue emulation.
The two are *not* auto-chained by default even in the inline stand-ins (an ingestion test's
webhook response reflects ingestion only) — chaining them into one call is itself a further
simplification beyond "runs synchronously", so it's opt-in per test
(`buildTestApp({ chainInvestigation: true })`) rather than baked into every ingestion test
that never asked for it.

## 11. Security

Encryption in transit (TLS everywhere) and at rest (credential envelope encryption, DB-
level encryption via the host); secure, `httpOnly`, `SameSite` cookies for session; RBAC
(`OrganizationMember.role`: OWNER/ADMIN/MEMBER/VIEWER, enforced in API middleware); strict
tenant isolation (§8); audit log entry on every AI tool call and every user-initiated
mutating action; request IDs threaded through logs; per-org and per-IP rate limiting on
`apps/api`; webhook signature verification; Zod validation on every input and every LLM
tool-call output before it's trusted. Full detail: `docs/security.md`,
`docs/multi-tenancy.md`.

## 12. Knowledge system

PostgreSQL + `pgvector` on Neon. `KnowledgeEmbedding.organizationId` is part of every
similarity-search query — there is no cross-org fallback path. Sources: past incidents
(auto-embedded on resolution), runbooks, uploaded docs, manually authored knowledge.

## 13. MVP scope

Real end-to-end: Jira, ServiceNow, Microsoft Fabric Map Server.
Mock (labeled `MOCK` in the UI, real interface/schema, canned/simulated responses):
Databricks, Snowflake, Airflow, Azure, AWS, GCP, Kubernetes, Datadog, Splunk, Dynatrace,
New Relic, PagerDuty. A `MOCK_MODE=true` env flag runs the entire flow — mock Jira incident
→ mock/real Map Server → AI investigation → RCA → approval → remediation → verification →
Jira updated — with zero production credentials required.
