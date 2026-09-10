# Implementation Plan

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Update this file as work
lands — it's the source of truth for what's actually built vs. spec'd.

## Phase 0 — Foundation docs & repo (this session)
- [x] `ARCHITECTURE.md`
- [x] `IMPLEMENTATION_PLAN.md`
- [x] Git repo initialized, pushed to `github.com/amansharma4098/resolution`
- [x] `.env`/`.gitignore` — Cloudflare token stored untracked
- [~] Monorepo scaffold (`apps/*`, `packages/*`)
- [ ] Cloudflare Pages project + R2 bucket provisioned via API
- [ ] `docker-compose.yml` (Postgres+pgvector, Redis) for local dev

## Phase 1 — Foundation (app skeleton, auth, orgs, RBAC)
- [ ] Turborepo/npm-workspaces root config, shared `tsconfig`, `eslint`, `prettier`
- [ ] `packages/database`: Prisma schema (full model list from ARCHITECTURE.md §8), migrations
- [ ] `packages/shared`: Zod schemas for core types, `NormalizedIncident`, enums
- [ ] `packages/ui`: `tokens.ts` design system (palette, type scale from spec §13)
- [ ] `apps/api`: Fastify bootstrap, session auth (email/password + OAuth-ready), request-ID middleware, error shape
- [ ] `apps/web`: Next.js bootstrap, Tailwind + shadcn/ui wired to design tokens, login/signup, org creation/switcher
- [ ] RBAC: `OrganizationMember.role`, middleware enforcing role per route
- [ ] Tenant-context middleware: derive `organizationId` from session, never from client input
- [ ] Audit log write on auth events
- [ ] Tests + typecheck + lint green

## Phase 2 — Configuration system
- [ ] `packages/credentials`: `SecretProvider` interface + `EncryptedDbSecretProvider`
- [ ] Credential CRUD API + UI (create/list/mask/test/rotate)
- [ ] `packages/map-servers`: registry + base interface + config wizard API
- [ ] Map Server CRUD API + UI (select type → select credential → configure environment → configure capabilities)
- [ ] Integration CRUD (incident sources) API + UI

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
