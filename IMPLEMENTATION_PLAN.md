# Implementation Plan

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Update this file as work
lands — it's the source of truth for what's actually built vs. spec'd.

## Phase 0 — Foundation docs & repo ✅ complete
- [x] `ARCHITECTURE.md`
- [x] `IMPLEMENTATION_PLAN.md`
- [x] Git repo initialized, pushed to `github.com/amansharma4098/resolution`
- [x] `.env`/`.gitignore` — Cloudflare token stored untracked
- [x] Monorepo scaffold (`apps/*`, `packages/*`)
- [x] Cloudflare Pages project (`resolution`) + R2 bucket (`resolution-storage`) provisioned via API
- [x] `docker-compose.yml` (Postgres+pgvector, Redis) for local dev

## Phase 1 — Foundation (app skeleton, auth, orgs, RBAC) ✅ complete
- [x] Turborepo/npm-workspaces root config, shared `tsconfig`, `eslint`, `prettier`
- [x] `packages/database`: Prisma schema (28 models per ARCHITECTURE.md §8), migrations —
      `UserRepository`, `OrganizationRepository`, `TenantScopedRepository` base class,
      `auditLogWriter` Prisma adapter
- [x] `packages/shared`: Zod schemas — `NormalizedIncident`, RCA claim types
      (FACT/INFERENCE/HYPOTHESIS with evidence-citation enforcement)
- [x] `packages/ui`: `tokens.ts` design system (exact palette/type scale from spec §13),
      `StatusBadge` component
- [x] `packages/security` (new — not in original plan list, needed to share RBAC/session/
      password/audit logic between apps/api and future apps/worker): password hashing,
      session JWT (identity-only claim, role always re-resolved from DB), RBAC role
      ranking, redacting audit-log writer
- [x] `apps/api`: Fastify bootstrap, cookie-based session auth (signup/login/logout/me),
      request-ID middleware + header, `{error:{code,message,requestId}}` error shape,
      rate limiting, CORS
- [x] `apps/web`: Next.js App Router bootstrap, Tailwind wired to design tokens via CSS
      variables, dark hero landing page, login/signup, org creation, dashboard shell with
      nav (unbuilt sections shown disabled with a "soon" tag, not fake links) and an org
      switcher
- [x] RBAC: `Role` ranking (OWNER>ADMIN>MEMBER>VIEWER), `requireMinimumRole` preHandler
- [x] Tenant-context middleware: `X-Organization-Id` header re-validated against
      `OrganizationMember` on every request; non-members get 404, never 403 (no membership
      disclosure)
- [x] Audit log write on `organization.created` (identity events — signup/login — have no
      org yet; `AuditLog.organizationId` made nullable to allow future account-level events)
- [x] Tests + typecheck + lint green: 37 tests across 6 packages, full `turbo run
      typecheck|lint|test|build` green, real `apps/api` server smoke-tested booting and
      serving requests end to end (DB-dependent routes correctly 500 without a live
      Postgres, confirming wiring rather than masking failures)

**Not yet done, deferred to when needed:** integration tests against a live Postgres (no
Docker available in this environment — apps/api tests use an in-memory fake DB covering
the same route behavior); OAuth login (email/password only so far); organization member
invite/management UI.

## Phase 2 — Configuration system ✅ complete (capability toggling deferred to Phase 5)
- [x] `packages/credentials`: `SecretProvider` interface + `EncryptedDbSecretProvider` (real
      envelope encryption — random per-credential data key, wrapped by a root key, AES-256-
      GCM, organizationId as AAD so a blob can't decrypt under the wrong org's context) +
      per-`authenticationType` Zod payload schemas + masked-hint derivation
- [x] Credential CRUD API + UI (create/list/test/rotate/delete) — secret never returned
      after creation, only a masked hint; ADMIN+ required for all mutating routes
- [x] `packages/map-servers`: `Capability`/`MapServerProvider`/`MapServerContext` types,
      registry (`registerMapServer`/`getMapServerProvider`/`getMapServerCatalog`) — starts
      empty on purpose, FABRIC lands Phase 5, mocks land Phase 10; the catalog honestly
      shows every `MapServerType` as unavailable until a provider actually registers
- [x] Map Server CRUD API + UI (select type from the live catalog → select credential →
      environments → JSON config). **Capability selection UI deferred**: there's nothing
      real to toggle until Phase 5 registers a provider with actual capabilities — building
      that UI now would mean it's always empty, so it ships alongside Phase 5 instead
- [x] Integration CRUD (incident sources) API + UI — config layer only; real Jira/
      ServiceNow OAuth and ingestion are Phases 3–4
- [x] `docs/credentials.md`
- [x] Tests: 77 tests across 8 packages (16 new in `packages/credentials`, 5 in
      `packages/map-servers`, 19 new route tests in `apps/api` covering tenant isolation,
      RBAC gating, honest not-yet-available status, and full envelope-encryption round-trip
      through the real HTTP layer); `turbo run typecheck|lint|test|build` all green; real
      server smoke-tested with the new routes wired

## Phase 3 — Jira integration (real)
- [ ] OAuth app + connection flow
- [ ] Webhook receiver (`/api/webhooks/jira`, signature verify, idempotent, enqueues)
- [ ] Incident ingestion worker: Jira issue → `NormalizedIncident`
- [ ] Write-back: status/comment updates to Jira issue

## Phase 4 — ServiceNow integration (real)
- [ ] Auth (basic/OAuth per instance config)
- [ ] Incident ingestion (table API polling or webhook)
- [ ] Write-back updates

## Phase 5 — Fabric Map Server (real)
- [ ] Service-principal auth adapter
- [ ] Capabilities: `get_workspace`, `get_pipeline`, `get_pipeline_run`, `get_logs`, `retry_pipeline`
- [ ] Health check, config schema, tests

## Phase 6 — Incident engine
- [ ] State machine (`IncidentStatus` transitions) in `packages/agents`
- [ ] BullMQ queues wired in `apps/worker` (all 8 queues from ARCHITECTURE.md §10)
- [ ] Incident timeline (`IncidentEvent`) + evidence storage (`IncidentEvidence`)

## Phase 7 — AI: investigation, knowledge, RCA
- [ ] LLM client wrapper (`packages/ai`), tool-calling harness bound to Map Server registry
- [ ] Investigation Agent: dynamic Map Server discovery + evidence collection
- [ ] Knowledge Agent: pgvector ingestion + org-scoped retrieval
- [ ] RCA Agent: FACT/INFERENCE/HYPOTHESIS output schema, confidence, cited evidence, alternatives
- [ ] Evidence-citation enforcement (reject uncited FACT claims)

## Phase 8 — Remediation
- [ ] Policy engine (pure code) + visual policy builder UI
- [ ] Resolution modes (Observe Only/Recommend/Human Approved/Autonomous) at org level
- [ ] Approval flow (API + UI: `ApprovalPanel`)
- [ ] Remediation execution via Map Server mutating capabilities
- [ ] Verification Agent: real-state re-check, retry/escalate logic

## Phase 9 — Dashboard
- [ ] Metrics (`UsageMetric` rollups), `MetricCard`
- [ ] Incidents list/detail, `IncidentTimeline`, `EvidenceCard`, `RCASection`, `RemediationPanel`, `VerificationPanel`
- [ ] Audit log viewer
- [ ] Full nav: Dashboard, Incidents, AI Investigations, Map Servers, Credentials, Knowledge, Runbooks, Automation Policies, Approvals, Audit Logs, Integrations, Analytics, Settings, Billing

## Phase 10 — Mock providers
- [ ] Mock Map Servers: Databricks, Snowflake, Airflow, Azure, AWS, GCP, Kubernetes, Datadog, Splunk, Dynatrace, New Relic
- [ ] Mock incident source: PagerDuty
- [ ] `MOCK` badge component + enforcement (never disguised as real)
- [ ] `MOCK_MODE=true` full end-to-end demo path

## Phase 11 — Billing
- [ ] `BillingProvider` abstraction (Stripe adapter), plans, metering off `UsageMetric`
- [ ] Billing UI

## Phase 12 — Production hardening
- [ ] Security review pass (`security-review` skill) on full diff
- [ ] Load test critical paths (webhook ingestion, investigation queue)
- [ ] Dark mode pass on design tokens
- [ ] Final docs pass (`docs/*.md` complete and accurate)

## Definition of done
See ARCHITECTURE.md is not the DoD — the DoD is the full user journey in the original
spec §17: signup → org → incident source → credential → Map Server → environment →
capabilities → policy → test → activate → real incident → AI investigation (dynamic Map
Server + credential selection) → evidence → historical search → RCA → resolution →
policy evaluation → approval (if required) → remediation → verification → incident
resolved on source → audit trail → dashboard reflects it. This must work with **zero**
production credentials via `MOCK_MODE`.
