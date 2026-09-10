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

## 2. Hosting topology (hybrid Cloudflare)

The spec requires Postgres+pgvector and Redis+BullMQ, which Cloudflare's native primitives
(D1/SQLite, Queues, Workers) don't support directly (no long-running Node processes, no
pgvector). Decision: **hybrid**.

| Concern | Provider | Why |
|---|---|---|
| Frontend (`apps/web`, Next.js) | Cloudflare Pages | CDN, TLS, DNS already at Cloudflare |
| Static/blob assets, uploaded docs | Cloudflare R2 | S3-compatible, cheap egress |
| DNS / edge routing | Cloudflare | already the registrar/DNS target |
| API (`apps/api`) | Node-capable host (Railway/Fly/Render) | needs persistent process, Prisma, raw TCP to Postgres/Redis |
| Worker (`apps/worker`, BullMQ consumers) | same Node-capable host | BullMQ needs a real Redis TCP connection; Workers can't run long-lived consumers |
| Primary DB | Neon Postgres (+ pgvector extension) | serverless Postgres, pgvector for knowledge embeddings, branching for previews |
| Queue backend | Upstash Redis (or managed Redis on the same host) | BullMQ-compatible |
| Secrets (prod) | Cloudflare account holds only the CF API token; app secrets live in the Node host's secret store / AWS Secrets Manager / Azure Key Vault per `SecretProvider` (§6) | keeps blast radius per-provider |

Local dev: `docker-compose.yml` runs Postgres (pgvector image) + Redis so the whole stack
runs with zero cloud accounts. See `docs/deployment.md`.

The Cloudflare API token provided is stored only in the untracked `.env` (see
`.env.example` for the shape) and used to provision the Pages project + R2 bucket via the
Cloudflare API — never committed, never logged.

## 3. Monorepo layout

```
apps/
  web/       Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui — deployed to CF Pages
  api/       Fastify HTTP API — auth, REST endpoints, webhook receivers
  worker/    BullMQ consumers — the actual agent pipeline execution
packages/
  database/    Prisma schema + generated client + repositories (tenant-scoped access only)
  ai/          LLM client, prompt templates, RCA/hypothesis engine, embeddings
  agents/      Orchestrator + Investigation/Knowledge/Context/RCA/Resolution/Remediation/
               Verification/IncidentUpdate agents
  integrations/  Incident-source adapters (Jira, ServiceNow, PagerDuty, webhook)
  map-servers/   One folder per provider implementing the MapServer interface (§4)
  credentials/   SecretProvider abstraction + encryption
  security/      RBAC, tenant-context middleware, audit logging, rate limiting
  shared/        Zod schemas, shared types, normalized Incident shape, constants
  ui/            design-tokens.ts, shared React components (StatusBadge, IntegrationCard, …)
```

## 4. Map Server interface (core architectural principle)

The agent NEVER makes arbitrary API calls and NEVER executes a raw command string. Every
action is a typed capability call validated against a Zod schema before and after
execution.

```typescript
// packages/map-servers/types.ts
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

The provider self-registers into a `MapServerRegistry` (`packages/map-servers/registry.ts`)
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
// packages/credentials/secret-provider.ts
export interface SecretProvider {
  encrypt(plaintext: Record<string, unknown>, context: { organizationId: string }): Promise<string>;
  decrypt(ciphertext: string, context: { organizationId: string }): Promise<Record<string, unknown>>;
  rotate(credentialId: string): Promise<void>;
}
```

Implementations: `EncryptedDbSecretProvider` (default, local/dev — AES-GCM blob in
Postgres), `AwsSecretsManagerProvider`, `AzureKeyVaultProvider`, `GcpSecretManagerProvider`
— selected via `SECRET_PROVIDER` env var, same interface, swappable without touching
callers. See `docs/credentials.md`.

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

PostgreSQL via Prisma, UUID primary keys, every tenant-owned table carries
`organizationId` with a composite index `(organizationId, createdAt)` or similar per
access pattern. Full schema: `packages/database/prisma/schema.prisma`. Model list:

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

Base: `/api/*` on `apps/api` (Fastify), JSON, Zod-validated request/response, versioned
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

Redis + BullMQ, queues: `incident-ingestion, incident-investigation, knowledge-retrieval,
ai-analysis, remediation, verification, notification, webhook-processing`. Webhook HTTP
handlers do signature verification + idempotency-key check, enqueue, return `202`
immediately — all agent work happens in `apps/worker` consumers.

Idempotency: webhook events keyed by `(source, externalId, eventHash)` in `WebhookEvent`;
remediation actions keyed by `(incidentId, capabilityKey, runId)` — a remediation is never
re-executed without first re-reading real external-system state.

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
