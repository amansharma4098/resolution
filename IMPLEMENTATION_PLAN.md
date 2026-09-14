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
      password/audit logic across apps/api's route and queue-consumer code): password hashing,
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
- [x] Tenant-context middleware: `X-Tenant-Id` header re-validated against
      `OrganizationMember` on every request; non-members get 404, never 403 (no membership
      disclosure)
- [x] Audit log write on `organization.created` (identity events — signup/login — have no
      org yet; `AuditLog.tenantId` made nullable to allow future account-level events)
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
      GCM, tenantId as AAD so a blob can't decrypt under the wrong org's context) +
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

## Interlude — migration to Cloudflare-only ✅ complete

Not a numbered phase — a mid-course architecture pivot requested after Phase 2, replacing
the "hybrid" hosting decision from Phase 0 (Postgres/Redis on a Node host) with everything
running on Cloudflare's own products. Rewrote what Phases 1–2 had already built rather than
adding new features:

- [x] `packages/database`: Prisma schema ported from Postgres to **D1** (SQLite) — every
      `enum` became a documented `String`, every `Json` field became a `String` column with
      manual serialize/parse (`json-field.ts`); migrations regenerated and applied to a real
      D1 database (`resolution-db`, 28 tables, verified via direct SQL query)
- [x] `packages/credentials`: envelope encryption rewritten from Node's `node:crypto` to the
      **Web Crypto API** (`crypto.subtle`) — native in Workers, no compat flag; same
      envelope-encryption design (random data key wrapped by a root key, AAD-bound to
      `tenantId`), same 16 tests passing unmodified in behavior
- [x] `packages/security`: session JWT switched from `jsonwebtoken` to **jose** (Web
      Crypto-based); session cookie `SameSite` fixed to `None` in production (Pages and the
      Worker are different sites — `Lax` would have silently dropped the cookie on every
      cross-origin fetch)
- [x] `apps/api`: rewritten from **Fastify to Hono**, deployable as a Cloudflare Worker —
      every route, all middleware (auth, tenant-context, rate-limit, error handling), and
      the full test suite (32 tests) ported and passing
- [x] Deployed for real: Worker at `resolution-api.amansharma4098.workers.dev`, D1 database
      migrated, secrets set via `wrangler secret put`. Verified against the live deployment,
      not just tests: signup, login, org creation, and credential encryption all exercised
      directly against production
- [x] Found and fixed a real D1 platform gap along the way: Prisma's interactive
      `$transaction(async (tx) => ...)` isn't supported on D1 (confirmed via a live error
      from the deployed Worker), only the batch array form —
      `OrganizationRepository.createWithOwner` now pre-generates the org UUID client-side so
      both inserts go in one batch call
- [x] `apps/web`: Cloudflare Pages project recreated as Git-connected (the original was
      Direct Upload, which Cloudflare doesn't allow converting after the fact), switched to
      Next.js static export, `NEXT_PUBLIC_API_URL` wired to the live Worker
- [x] ARCHITECTURE.md §2/§8 rewritten to describe the Cloudflare-only topology and the
      platform gaps worked around

**Deferred at the time, since landed:** Cloudflare Queues — nothing in Phases 1–2 used
background jobs yet; wired for real in Phase 6 (see that entry). Vectorize is still
deferred to Phase 7. There is no separate `apps/worker` — queue consumers live in
`apps/api/src/queue/`, run by the same Worker as the HTTP API (see ARCHITECTURE.md §3).

## Phase 3 — Jira integration (real) ✅ mostly complete
- [x] Auth: HTTP Basic (email + Atlassian API token) via the existing Credential system —
      chosen over OAuth 2.0 (3LO) because that needs an app registered in the Atlassian
      developer console with a callback URL, a customer-side setup step this doesn't
      assume; Basic Auth is what Jira Cloud's REST API actually expects for
      server-to-server calls and is fully real (`packages/integrations/src/jira/client.ts`)
- [x] Webhook receiver: `POST /api/webhooks/jira/:integrationId`, authenticated by a
      constant-time-checked `X-Webhook-Secret` header (Jira Cloud doesn't sign its own
      webhooks), idempotent via `WebhookEvent`'s unique constraint AND `Incident`'s own
      (org+source+externalId) constraint. Processes inline rather than enqueueing — no
      queue exists yet (Phase 6 adds Cloudflare Queues), documented as a known
      simplification, not a design endpoint
- [x] Incident ingestion: real Jira webhook payload → `NormalizedIncident`
      (`normalizeJiraWebhook`), verified against a simulated live webhook hitting the
      deployed Worker, with the resulting row checked directly in D1
- [x] Real connectivity test: `POST /api/integrations/:id/test` calls the actual Jira
      `/rest/api/3/myself` endpoint with the attached, decrypted credential
- [x] Write-back capability built (`JiraClient.addComment`/`transitionIssue`) — not yet
      *triggered* by anything, since that requires Phase 6's incident lifecycle /
      Phase 8's remediation flow to decide when to call it
- [ ] Not tested against a real Jira tenant (no test Atlassian account available in this
      environment) — the API calls match Atlassian's published REST v3 docs exactly, but
      this is stated plainly rather than claimed as integration-tested against the real
      service. Worth a real-tenant smoke test before calling this fully done.

## Interlude — enterprise tenant/member management ✅ complete

Not originally scoped as its own phase — added after explicit direction that the product
needs a real "admin creates/invites local users within their own tenant" flow for
enterprise sales, which Phase 1's RBAC (Organization=tenant, OrganizationMember.role) made
possible but never exposed.

- [x] `POST/GET/PATCH/DELETE /api/organizations/members` — an OWNER/ADMIN adds a teammate
      by email (existing users are just added to the org; a brand-new email gets a freshly
      created local account with a one-time temporary password, same masking discipline as
      a credential's secret); changes roles; removes members. Refuses to demote or remove
      the last remaining OWNER. No self-serve path exists for a user to join someone else's
      org — every membership is either the org creator or explicitly added by an ADMIN+
- [x] `apps/web` Settings/Team page — also fills a real gap from Phase 1 (the nav listed
      "Settings" as a live link with no page behind it)
- [x] No email delivery wired up yet — the temporary password is shown once to the
      inviting admin, who is responsible for relaying it out-of-band. An email provider is
      a reasonable Phase 12 (or sooner, on request) addition

## Phase 4 — ServiceNow integration (real) ✅ mostly complete
- [x] Auth: HTTP Basic (ServiceNow username + password) via the existing Credential
      system — same reasoning as Jira's Basic Auth choice over OAuth2
      (`packages/integrations/src/servicenow/client.ts`)
- [x] Incident ingestion: webhook, not polling — `POST
      /api/webhooks/servicenow/:integrationId`, sharing the exact same secret-header
      auth, idempotency (WebhookEvent + Incident unique constraints), and inline-
      processing pattern as Jira's webhook (both now go through one shared
      `ingestWebhook` helper in `apps/api/src/routes/webhooks.ts`). ServiceNow has no
      single standard outbound-webhook payload the way Jira does, so this defines and
      documents the exact JSON shape a customer's Business Rule / Flow Designer action
      should POST (mirrors the incident table's own field names)
- [x] Real connectivity test: `POST /api/integrations/:id/test` calls the actual
      ServiceNow Table API (`GET /api/now/table/incident?sysparm_limit=1`) with the
      attached, decrypted credential
- [x] Write-back capability built (`ServiceNowClient.addWorkNote`/`updateState`) — not
      yet triggered by anything, same as Jira's write-back (needs Phase 6/8)
- [ ] Not tested against a real ServiceNow instance (no test account available) — same
      caveat as Jira: matches ServiceNow's published Table API docs, stated plainly
      rather than claimed as integration-tested

## Phase 5 — Fabric Map Server (real) ✅ mostly complete
- [x] Service-principal auth adapter: Azure AD OAuth2 client-credentials against the
      standard `login.microsoftonline.com` v2.0 token endpoint (well-documented, solid
      ground) authorizing calls to the Fabric REST API (`packages/map-servers/src/fabric/`)
- [x] Capabilities: `get_workspace`, `get_pipeline`, `get_pipeline_run`, `get_logs`,
      `retry_pipeline` — all five, matching ARCHITECTURE.md §4 exactly. `get_logs` is
      honest about a real API gap: Fabric has no dedicated log-streaming endpoint, so it
      surfaces the job instance's own status/failureReason rather than fabricating log
      lines. `retry_pipeline` is the only mutating one (riskLevel LOW, defaults to AUTO
      per the spec's risk table)
- [x] Health check (lists workspaces visible to the service principal — a real,
      config-independent connectivity check since `MapServerContext` carries no
      org-configured workspaceId), config schema (`workspaceId`), 20 tests
- [x] First real provider registered in the registry — wired at `apps/api/src/worker.ts`'s
      module scope (once per Worker isolate, guarded idempotent; deliberately not inside
      `packages/map-servers`'s own index so apps/api's tests keep an empty registry by
      default) and confirmed live: `/api/map-servers/:id/test` for a FABRIC-typed Map
      Server now runs the real `healthCheck` with a real decrypted credential
- [x] Closed the Phase 2 gap this unblocked: `MapServerCapability` rows are now
      auto-created (all disabled by default) when a Map Server is created for a type with
      a registered provider, and `PATCH /api/map-servers/:id/capabilities/:key` lets an
      ADMIN+ toggle one — with a lean inline toggle UI on the Map Servers page
- [ ] Not tested against a real Fabric tenant (no test tenant available) — flagged with
      extra care here specifically because Fabric's public REST API is newer and less
      standardized than Jira's/ServiceNow's, so the risk of a shape mismatch is higher

## Phase 6 — Incident engine ✅ mostly complete
- [x] `packages/agents` (new): the `IncidentStatus` state machine — pure code
      (ARCHITECTURE.md §6: deterministic business logic is never LLM-driven), a documented
      transition table (`transition()`/`canTransition()`/`isTerminal()`), 9 tests covering
      the happy path, the AUTO-policy fast path, illegal-transition rejection, and every
      terminal/re-entrant edge. Not wired into a live code path yet — nothing transitions
      an incident beyond its initial `NEW` until Phase 7's orchestrator exists to drive it;
      built and tested now so that orchestrator has a real, correct state machine to call
- [x] **Cloudflare Queues, not BullMQ** — ARCHITECTURE.md §2's Cloudflare-only pivot means
      this is a real architecture change from the original plan, not a rename. Created
      `resolution-incident-ingestion` (+ a dead-letter queue) and wired the first of the
      spec's 8 named queues for real: `POST /api/webhooks/jira|servicenow/:integrationId`
      now does only auth + shape validation and enqueues (202 immediately — ARCHITECTURE.md
      §10), and `apps/api/src/worker.ts`'s `queue` export is the real consumer
      (`apps/api/src/queue/consumer.ts`) that does the actual idempotency check,
      normalization, and Incident creation. This closes the "processes inline, no queue
      yet" simplification called out honestly in Phases 3–4. Verified live: enqueued a real
      webhook against the deployed Worker and confirmed the resulting Incident in D1.
      Tests use a synchronous inline stand-in (`queue/inline-queue.ts`) with identical
      processing logic — documented as the one behavioral difference from production
      (decoupled timing), not a different code path
- [x] Incident timeline: `IncidentEvent` rows written on ingestion (`type: "ingested"`)
- [ ] The other 7 named queues (`incident-investigation`, `knowledge-retrieval`,
      `ai-analysis`, `remediation`, `verification`, `notification`,
      `webhook-processing` for other sources) aren't created yet — deliberately: each
      needs a real consumer, and those consumers are Phase 7/8's agents, which don't exist
      yet. Creating empty queue resources with no consumer now would be exactly the kind of
      placeholder-dressed-as-done the project's own ground rules warn against; they'll be
      created alongside the phase that actually consumes them
- [x] `IncidentEvidence` storage — landed with Phase 7 below, as planned

## Phase 7 — AI: investigation, RCA ✅ mostly complete
- [x] `packages/ai` (new): `LlmClient` interface with two implementations — a real Anthropic
      client (`@anthropic-ai/sdk`, model `claude-opus-5`, adaptive thinking) and a
      deterministic `MOCK_MODE` client. The mock isn't a canned-response stub: it inspects
      the real tool catalog and real `tool_result` content it's given (including genuine
      `evidenceId`s written to `IncidentEvidence`), so the whole pipeline downstream of the
      LLM call — evidence persistence, citation enforcement, state transitions — runs for
      real in tests/CI with zero production credentials, per the project's standing MVP
      requirement. `zodToToolSchema` derives Anthropic tool JSON-schemas directly from a
      capability's existing Zod `inputSchema` (and from `RootCauseAnalysisOutput` itself for
      the forced-structured-output tool below) — one schema, not two kept in sync by hand.
      **Verified against the real Anthropic API**, not just mocked-fetch tests: the user
      supplied a live `ANTHROPIC_API_KEY` mid-phase, used for a one-off live tool-call smoke
      test (confirmed request/response shape) and now set as this Worker's real secret —
      see the honesty note on `MOCK_MODE` below
- [x] Investigation Agent (`packages/agents/src/investigation`): a hand-written multi-turn
      tool-calling loop (not the SDK's beta Tool Runner — the tool list is assembled
      dynamically per-org from the Map Server registry, and each call needs bespoke side
      effects a generic runner doesn't fit as directly as owning the loop does). Tools are
      built only from capabilities an org has both enabled *and* whose provider marks
      `mutating: false` — a mutating capability is invisible to investigation regardless of
      its enabled state; that's Phase 8 remediation's territory, gated by policy + approval
- [x] RCA is a forced tool call (`submit_rca`), not `output_config.format` — its JSON schema
      comes from `packages/shared/src/rca.ts`'s `RootCauseAnalysisOutput`, and the agent
      re-validates the model's tool input against that *same Zod schema* (not just its
      JSON-schema shape) before accepting it, so the "a FACT claim must cite at least one
      evidenceId" `.refine()` rule is actually enforced — an invalid submission is rejected
      with a specific error and the model gets to retry, not silently coerced or dropped
- [x] Evidence-citation enforcement: proven by a dedicated test asserting a FACT claim with
      no evidenceId is rejected server-side even though it matches the tool's JSON schema
      shape (schema alone can't express the rule)
- [x] `IncidentEvidence` rows written per successful tool call; `RootCauseAnalysis` persisted
      on success. Wired into the incident lifecycle for the first time — `INVESTIGATING` →
      `RCA_COMPLETE` on success, `INVESTIGATING` → `ESCALATED` on refusal or non-convergence
      (`InvestigationIncompleteError`, bounded by `maxIterations`) — via
      `incident-state-machine.ts`, which nothing had consumed until now
- [x] Second Cloudflare Queue wired for real: `resolution-incident-investigation` (+ DLQ).
      Ingestion's consumer enqueues onto it exactly once, only on the branch that actually
      inserted a new `Incident` row (never on a redelivered/duplicate webhook). One Worker
      script still — `worker.ts`'s `queue` export now dispatches on `batch.queue` name
- [x] `POST /api/incidents/:id/investigate` — manual (re-)trigger for any status the state
      machine already allows transitioning to `INVESTIGATING` from (`NEW`, `ESCALATED`,
      `FAILED`), gated through `canTransition()` rather than a hardcoded status list
- [x] `GET /api/incidents/:id` now returns evidence, the latest RCA, and the full event
      timeline; the incident detail page renders all three (claims color-coded by
      FACT/INFERENCE/HYPOTHESIS, citations resolved to the capability that produced them) —
      27 tests added across `packages/ai`, `packages/agents`, `apps/api`
- [ ] Knowledge Agent (pgvector → Cloudflare Vectorize ingestion + org-scoped retrieval): not
      started — genuinely deferred, not silently dropped. The Investigation/RCA loop above
      doesn't need it (it grounds claims in live tool evidence, not a knowledge base), but a
      "search past incidents/runbooks" capability is real scope this phase didn't cover
- **Honesty note on `MOCK_MODE`**: production's `MOCK_MODE` is now `false` — real incidents
  ingested against the live deployment get a real, billed `claude-opus-5` investigation, not
  the mock. This is a deliberate, disclosed choice (the user provided a real
  `ANTHROPIC_API_KEY`, stored only via `wrangler secret put`, never committed) rather than a
  default the project would have made unprompted; `MOCK_MODE=true` remains the documented
  zero-credential path for local dev/CI and is still what every automated test runs against

## Phase 8 — Remediation ✅ complete
- [x] Policy engine (`packages/agents/src/policy-engine.ts`) — pure code, no LLM
      (ARCHITECTURE.md §6). Effective behavior = the stricter of an AutomationPolicy row's
      own `behavior` and the org's `resolutionMode` ceiling; a `resolutionModeFloor` below
      the org's current mode denies outright rather than falling back to a weaker behavior.
      Unconfigured capabilities default to APPROVAL once the org is at least in RECOMMEND
      mode, DENY below it — never silently AUTO. 8 tests covering the full
      (mode × behavior × floor) matrix
- [x] `AutomationPolicy` CRUD (`/api/automation-policies`, admin-only) + a real UI page
      (`/dashboard/automation-policies`) — upsert-in-place per (mapServerType,
      capabilityKey), a capability-key dropdown sourced from the org's actual configured Map
      Servers when one exists, free-text fallback otherwise
- [x] Resolution modes at the org level — `Organization.resolutionMode`
      (OBSERVE_ONLY/RECOMMEND/HUMAN_APPROVED/AUTONOMOUS) already existed in the schema;
      `PATCH /api/organizations/:id` (admin-only) + a selector on the Automation Policies
      page make it real. Documented simplification: RECOMMEND and HUMAN_APPROVED both cap at
      APPROVAL in the policy engine for now — see policy-engine.ts's header comment for why
- [x] Resolution Agent (`packages/agents/src/remediation/resolution-agent.ts`) — same
      hand-written tool-calling pattern as Phase 7's Investigation Agent, offered only the
      org's enabled *mutating* capabilities (the inverse filter from investigation) plus an
      explicit `no_remediation_needed` decline tool, so "no safe automated fix exists" is a
      real, honest outcome rather than a forced guess. Proposes at most one remediation —
      never executes it directly; that's gated by the policy engine below
- [x] Approval flow — `POST /api/incidents/:id/approvals/:approvalId/decide`
      (APPROVE/REJECT, admin-only), a global inbox (`GET /api/incidents/approvals/pending`,
      `/dashboard/approvals`) and inline Approve/Reject on the incident detail page. Approve
      executes the capability synchronously in the request (a single call plus the bounded
      verification loop below); reject transitions the incident straight to CLOSED and never
      touches the capability
- [x] Remediation execution via Map Server mutating capabilities — real, through the same
      `Capability.execute()` every read-only investigation call already went through
- [x] Verification — `Capability.verification` (packages/map-servers/src/types.ts, new
      optional field): a mutating capability can declare a read-only companion capability +
      how to build its input + how to classify PASSED/FAILED/RETRYING. Never an LLM
      (ARCHITECTURE.md §6). Wired real: Fabric's `retry_pipeline` now declares one, polling
      `get_pipeline_run` for the started job's status. Bounded retry loop (3 attempts, 2s
      apart) in the same consumer invocation, not a re-queued delayed message — a documented
      simplification (remediation-consumer.ts's header comment) for capabilities that
      resolve within seconds; longer-running remediation would need real re-queuing. A
      capability with no `verification` (or a misconfigured one) resolves honestly as
      "executed, unverified" rather than silently claiming confirmed success
- [x] Third real Cloudflare Queue: `resolution-incident-remediation` (+ DLQ). One consumer
      invocation covers propose → policy-gate → (if AUTO) execute → verify — not split
      further; ARCHITECTURE.md §10 explains why. Chained automatically off a successful
      RCA_COMPLETE, same `onXCompleted` hook pattern as ingestion→investigation
- [x] 41 new tests — packages/agents: 19 (`policy-engine` 8, `resolution-agent` 7,
      `verification-runner` 4); apps/api: 22 (`remediation-consumer` 9,
      `automation-policies` 6, `incidents` +5, `app.test.ts` +2) — full end-to-end approval
      flow proven through the real HTTP layer (webhook → ingest → investigate → RCA →
      propose → PENDING_APPROVAL → approve → executed → RESOLVED), not just unit-level
- [x] Verified live in production against the real Anthropic API, twice, with an
      AUTONOMOUS-mode org and an AUTO policy on `retry_pipeline` actually configured — real
      `claude-opus-5` correctly **declined** to remediate both times, for good reasons: (1)
      an incident with zero evidence and no pipeline identifiers, where inventing
      `workspaceId`/`pipelineId` to call the tool would have violated its own "never invent
      a value not offered to you" instruction; (2) an incident that *did* name a specific
      pipeline, where it reasoned that a nightly-recurring "transient" timeout reliably
      cleared by retry is more likely a deterministic condition the retry would mask, not
      fix — and that the RCA's own recommended fix (a pipeline-level retry policy) isn't
      something `retry_pipeline` can perform. Both are exactly the honest "no safe
      automated action exists" outcome the `no_remediation_needed` tool exists for, proving
      the decline path works with a real model under real policy pressure to act — arguably
      stronger evidence than a forced AUTO execution would have been. The AUTO
      execute→verify→resolve path itself is proven separately, thoroughly, by the 9
      `remediation-consumer` tests and the full HTTP approval-flow test (webhook → ingest →
      investigate → RCA → propose → PENDING_APPROVAL → approve → executed → RESOLVED)

## Phase 9 — Dashboard ✅ mostly complete
- [x] Metrics — `GET /api/metrics`, computed live from Incident/Resolution/RemediationAction/
      Approval rows on every request, not a precomputed `UsageMetric` rollup table. Deliberate:
      this project's current data volume doesn't justify a scheduled rollup job yet, and
      Phase 11's usage-based billing is the point a rollup job earns its keep (it needs one
      anyway, for metering) — documented in metrics.ts's header comment, not silently
      dropped. Same O(incidents) round-trip pattern as the approvals inbox. `MetricCard` +
      a real `/dashboard` (incident counts by status, open/resolved, avg resolution time,
      remediation funnel: proposed/denied/pending/approved/rejected/succeeded/failed/
      declined-no-action)
- [x] Incident list/detail, evidence, RCA section, remediation panel (resolution → action →
      approval → verification), timeline — all landed inline on the incident detail page in
      Phases 7–8, not as the spec's separately-named `IncidentTimeline`/`EvidenceCard`/
      `RCASection`/`RemediationPanel`/`VerificationPanel` components. Functionally complete;
      a future pass could split them into named components for reuse, but nothing about the
      feature set is missing
- [x] Audit log viewer — `GET /api/audit-logs` (cursor-paginated on `createdAt`, any member
      can view — knowing what happened to your org's incidents isn't ADMIN-gated the way
      changing policy is) + `/dashboard/audit`, "Load more" pagination
- [x] Nav: AI Investigations dropped as its own item — investigation results live inline on
      every incident's detail page (Incidents already covers it 1:1; a separate nav entry
      would just be a second path to the same list), Automation Policies/Approvals/Audit
      Logs promoted out of "soon" now that they're real. Knowledge (Phase 7, Vectorize),
      Runbooks (never built), Analytics (trends/charts beyond the Dashboard's current-state
      metrics), and Billing (Phase 11) remain honestly tagged "soon"
- [x] Fixed a real gap this phase surfaced: `Incident.resolvedAt` was never actually being
      set on the RESOLVED transition (remediation-consumer.ts) — the field existed in the
      schema since Phase 0 but nothing wrote it, which would have made "average resolution
      time" silently report null forever. Fixed alongside building the metric that needed it
- [x] Fixed a real turbo.json bug this phase's build surfaced: `@resolution/web`'s typecheck
      raced its own `next build` (both could run in parallel; typecheck only depended on
      upstream packages' builds, not its own) — `tsconfig.json` includes the generated
      `.next/types/**/*.ts`, so a typecheck that started before build finished failed with a
      spurious `TS6053 file not found`. Fixed by making `typecheck` depend on `build` (not
      just `^build`) for every package — costs nothing for packages whose typecheck doesn't
      depend on generated output, fixes it for the one that does
- [x] 7 new tests (`metrics`: 3, `audit-logs`: 4), full turbo typecheck/lint/test/build green

## Interlude — a live production auth bug, found and fixed ✅ complete

Not a planned phase — a real user report ("sign in stuck loading") led to a live debugging
session (`wrangler tail` against the production Worker + the reporter's own DevTools),
which found a genuine bug: `apps/web` and `apps/api` are different origins, forcing the
session cookie to be `SameSite=None`, which Safari's cross-site tracking prevention blocks
or strips (most aggressively in Private Browsing). Login/signup succeeded server-side every
time, but the browser never retained the session, silently bouncing the user back to
`/login`.

- [x] `functions/api/[[path]].ts` — a Cloudflare Pages Function (at the repo root, not
      `apps/web/functions`, because this project's Pages `root_dir` is the repo root and
      Functions are discovered relative to that) that proxies every `/api/*` request
      server-side to the Worker, transparently, including `Set-Cookie`. The browser now
      only ever talks to its own origin. `_redirects` was tried first (Cloudflare's
      documented "200 status = proxy" pattern) but its own docs confirm it can't proxy an
      external domain — only a real Function can `fetch()` anywhere
- [x] `NEXT_PUBLIC_API_URL` is now empty in Cloudflare Pages' env config (both
      production/preview), so `apiRequest` resolves same-origin relative paths that the
      Function intercepts. Verified with a real cookie-jar `curl` test (the cookie now
      belongs to the Pages domain, not the Worker's) and confirmed by the original reporter
      in their actual browser after the fix

## Interlude — platform Super Admin / tenant provisioning ✅ complete

Not originally scoped — added on explicit direction to support a sales-assisted enterprise
onboarding motion alongside self-serve signup (Phase 1/the enterprise tenant/member
management interlude): a platform-level Super Admin who can provision a brand-new tenant
and its initial admin user directly, without that admin needing to sign themselves up
first.

- [x] `User.isSuperAdmin` (new migration, `packages/database/prisma/migrations/
      00000000000001_add_super_admin`) — platform-level, orthogonal to
      `OrganizationMember.role`; a Super Admin isn't a member of any particular tenant.
      Provisioned directly in the database only — no self-serve or API path to grant it,
      same bootstrap discipline as every other root credential in this project
- [x] `apps/api/src/middleware/require-super-admin.ts` — a second, separate gate from
      `resolveTenantContext`/`requireMinimumRole`; runs straight after `authenticate`, no
      tenant context involved
- [x] `GET/POST /api/platform/tenants` — list every tenant on the platform (member/incident
      counts included) and provision a new one in one step: creates the `Organization` and,
      reusing the exact same auto-create-with-temporary-password pattern as the member-invite
      flow (now shared via `generateTemporaryPassword()` in `@resolution/security` rather
      than duplicated), its admin `User` as that org's `OWNER`. An existing email is just
      added as the new org's owner, no new password
- [x] **Additive, not a replacement**: `POST /api/organizations` (self-serve "create my own
      org") is deliberately untouched — the product now supports both a self-serve
      product-led motion and a sales-assisted one side by side, rather than forcing every
      tenant through one path
- [x] `apps/web` `/platform` — a separate layout from `/dashboard` (platform-level, not
      scoped to "my currently selected organization"), gated client-side on
      `user.isSuperAdmin` (server-side enforcement is what actually matters; the client gate
      is just UX), with a linked entry point from the dashboard sidebar for Super Admins
- [x] 5 new tests (`platform.test.ts`), all 101 prior apps/api tests still passing unchanged

## Interlude — self-serve password reset, auth rate limiting, branded auth UI ✅ complete

Not a planned phase — picked up alongside a UI pass on `/login`/`/signup`, then widened to
close two real gaps found while there: no self-service recovery path for a locked-out user,
and a rate-limit bug that made brute-force protection a no-op in production.

- [x] `/login`/`/signup` UI: shared `AuthLayout` split-screen shell (`apps/web/components/
      auth-layout.tsx`) reusing the landing page's dark-navy hero treatment, plus a small
      `Logo` wordmark component — no external asset
- [x] **Found and fixed**: `middleware/rate-limit.ts`'s in-memory hit log was created fresh
      inside `buildApp`, which `worker.ts`'s `fetch` handler calls on every request — so the
      "per-isolate" store documented in its own header comment never actually persisted
      across requests and silently rate-limited nothing in production. Fixed by hoisting the
      stores to module scope in `worker.ts` (outside `fetch`, where Worker isolates *do*
      keep state across requests) and threading them into `buildApp`/`buildAuthRoutes` as an
      injectable `rateLimitStores` option — tests/local dev still get fresh, isolated stores
      by default
- [x] Stricter, auth-specific rate limits layered on top of the existing global 100/min:
      `/login` (10/15min), `/signup` (5/hour), `/forgot-password` + `/reset-password`
      (5/hour) — all per client IP, same documented per-isolate caveat as the global limiter
- [x] `PasswordResetToken` model (new migration,
      `00000000000003_add_password_reset_token`) — only a SHA-256 hash of the token is
      stored (`packages/security/src/reset-token.ts`), single-use (`usedAt`), 1-hour TTL
- [x] `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` — same
      constant-response, no-enumeration discipline as `/login`: identical success message
      whether or not the email is registered, and no email sent for an unregistered one
- [x] `packages/email` (new package) — `EmailSender` abstraction: a real Resend sender (its
      plain HTTP API via `fetch`, no SDK — same reasoning as `jose` over `jsonwebtoken` for
      Workers compatibility) or, when `RESEND_API_KEY`/`EMAIL_FROM` aren't set, a
      console-logging fallback — same disclosed, zero-cost-by-default treatment as
      `MOCK_MODE`. Injectable into `buildApp` for tests
- [x] `apps/web` `/forgot-password` and `/reset-password` pages, linked from `/login`
- [x] 15 new tests across `packages/security` (4), `packages/email` (3), `apps/api`
      (5 in `auth.test.ts`, 3 in new `rate-limit.test.ts`) — full typecheck/lint/test green
      (117 apps/api tests passing, up from 109), plus a real `next build` (static export)
      confirming both new routes prerender

## Interlude — MCP: a generic connector, and being one ✅ complete

Not a planned phase — added on explicit direction. Two independent features sharing the
"MCP" (Model Context Protocol) name: this platform can now *consume* any org's MCP server
as a Map Server, and *is* one itself for read-only incident lookup. See `docs/mcp-server.md`
for the full writeup; summarized here.

- [x] **Consuming**: `packages/map-servers/src/mcp` — a Workers-native JSON-RPC client
      (`client.ts`, plain `fetch`, no SDK), a best-effort JSON Schema → Zod converter, and
      `mcpProvider`. Its capability set is live-discovered, not fixed at registration — the
      first provider to need this, so `MapServerProvider` gained an optional
      `discoverCapabilities` and every capability-lookup call site (`investigation-consumer`,
      `remediation-consumer`, `verification-runner`, the approval-execute path in
      `incidents.ts`) now goes through a new `resolveCapability` helper instead of a raw
      array `.find()` — a no-op for every existing provider, exercised only by this one.
      `POST /api/map-servers/:id/refresh-capabilities` (re-)discovers and persists them,
      additive and non-destructive (never deletes/disables a key on refresh). Discovered
      tools default to `HIGH`/mutating unless the server declares `readOnlyHint: true`.
      **Not yet supported**: OAuth/dynamic client registration for MCP servers that require
      it — only a static bearer token today.
- [x] **Being one**: `POST /api/mcp` — a JSON-RPC endpoint exposing `list_incidents`,
      `get_incident`, `get_rca` (read-only) plus, on explicit follow-up direction,
      `trigger_investigation`, `propose_remediation`, and `decide_approval` — an incident
      can now be fully investigated and resolved through MCP tool calls alone. These three
      call the *exact same* functions (extracted into a new
      `apps/api/src/lib/incident-actions.ts`) that `routes/incidents.ts`'s HTTP handlers
      call — never a re-implementation that could drift from the state-machine checks,
      policy-engine approval gating, or audit logging the dashboard enforces.
      `decide_approval` additionally requires the caller's membership role be `ADMIN`+
      (checked per-call via `hasRole`, since one MCP endpoint serves many orgs — there's no
      per-request tenant-context middleware to resolve it once). Authenticated via a new
      `ApiKey` model (new migration `00000000000004_add_api_key`) — long-lived bearer
      tokens, hash-only storage (same discipline as `PasswordResetToken`, refactored into a
      shared `packages/security/src/hash.ts`), managed via `/api/api-keys` and a new
      `apps/web` `/dashboard/api-keys` page (personal to a user, not org-scoped — every tool
      call still checks real membership in whichever `tenantId` it names, same
      "404 not 403" discipline as everywhere else)
- [x] 50 new tests in `apps/api` (151 total, up from 117), 37 new in `packages/map-servers`
      (52 total, up from 20), 4 new in `packages/security` (19 total) — full
      typecheck/lint/test green across the monorepo, plus a real `next build` confirming the
      new `/dashboard/api-keys` route prerenders

## Interlude — a generic inbound webhook connector ✅ complete

Not a planned phase — the third `IncidentSourceType` (`WEBHOOK`) existed in the data model
and the Integrations UI dropdown since Phase 3 with zero implementation behind it (same
honest "listed but not built" treatment as an unregistered `MapServerType`). Built on
explicit direction, alongside widening `POST /api/mcp` above. See `docs/webhooks.md`.

- [x] `packages/integrations/src/webhook/normalize.ts` — unlike Jira/ServiceNow (which
      mirror a real vendor's payload), there's no vendor shape to match here, so this *is*
      the shape: a small Zod schema (`externalId`, `title` required; `description`,
      `severity`, `priority`, `service`, `environment`, `resource`, `metadata` optional with
      sensible defaults) mapping directly onto `NormalizedIncident`
- [x] `POST /api/webhooks/webhook/:integrationId` — same secret-header auth and 202-then-
      async-processing shape as Jira/ServiceNow (ARCHITECTURE.md §10), but validates the
      body fully against that schema *before* the 202 (Jira/ServiceNow only sanity-check a
      couple of fields, since an event type they don't handle is an expected, silently
      ignored case for a documented third-party shape — a caller integrating directly
      against *our* schema benefits far more from an immediate, specific `400`)
- [x] Integrations UI: the "New integration" webhook-URL reveal now shows the exact JSON
      shape to `POST` when the type is `WEBHOOK`; the Test button reports "nothing to test"
      instead of a misleading `DISCONNECTED` (a purely inbound webhook has no outbound
      connection to verify)
- [x] 14 new tests (`packages/integrations`: 5, `apps/api`: 9) — full typecheck/lint/test
      green across the monorepo (324 tests total), plus a real `next build`

## Interlude — an in-app chat assistant, on the same tools as the MCP server ✅ complete

Not a planned phase — added on explicit direction. `POST /api/chat` and a new
`apps/web` `/dashboard/chat` page let an engineer investigate and resolve incidents by
typing, instead of clicking through the dashboard. See `docs/chat.md`.

- [x] Extracted `POST /api/mcp`'s tool catalog and execution out of `routes/mcp.ts` into a
      shared `apps/api/src/lib/incident-tools.ts` — chat and the MCP server are two entry
      points onto the *exact same* six tools (list/get incidents, get RCA, investigate,
      propose remediation, decide approval), never two implementations that could drift
      apart. `list_incidents`' output gained a `source` field so results can be grouped by
      platform, as asked
- [x] `routes/chat.ts` — a manual tool-calling loop (mirrors
      `packages/agents/src/investigation/investigation-agent.ts`'s reasoning for hand-writing
      it rather than the SDK's Tool Runner), bounded to 10 iterations per turn. Session- (not
      API-key-) authenticated and scoped to the dashboard's currently-selected organization —
      `tenantId` is stripped from the tool schemas the model sees and the real one is
      injected server-side on every call, overriding anything the model supplies
- [x] `packages/ai/src/mock-chat-client.ts` — a MOCK_MODE fallback dedicated to chat (not a
      reuse of the investigation agent's `mock-client.ts`, which is shaped around a
      different, submit_rca-specific loop and would either call an arbitrary tool or dead-end
      on a free-form message — neither an honest answer). Explains the limitation instead of
      faking a response; the tool-calling loop and every tool it can call stay fully real
- [x] `apps/web/app/dashboard/chat/page.tsx` — chat UI that keeps the raw message history
      (including tool_use/tool_result blocks) client-side, replayed each turn; renders a
      `list_incidents` result as an incident list grouped by platform instead of raw text
- [x] 9 new tests (`apps/api`: 7, `packages/ai`: 2) — full typecheck/lint/test green across
      the monorepo (333 tests total), plus a real `next build` confirming the new
      `/dashboard/chat` route prerenders

## Interlude — real observability: Datadog, and auto-alerting into auto-resolution ✅ complete

Not a planned phase — added on explicit direction ("make it an observability platform,
with an auto resolution agent of incidents"). Datadog moves from Phase 10's mock list to
real, end-to-end, both as a Map Server and as an incident source — see `docs/datadog.md`.

- [x] `packages/map-servers/src/datadog` — the second real Map Server after Fabric.
      `CUSTOM` credential (`apiKey`/`applicationKey` — Datadog's two-key auth doesn't fit any
      single-secret `AuthenticationType`). Six capabilities: `get_monitor`, `list_monitors`,
      `query_metrics`, `search_logs` (read-only evidence for an investigation) and
      `mute_monitor`/`unmute_monitor` (the mutating pair, `mute_monitor` MEDIUM risk with a
      `verification` spec that re-reads the monitor rather than trusting the mutation call's
      own response)
- [x] `packages/integrations/src/datadog` — a real incident source. Unlike Jira/ServiceNow,
      Datadog's webhook body is a customer-typed JSON template with Datadog's own
      `$VARIABLE` substitution tokens, not a fixed shape it sends; the exact template
      Resolution expects is documented (`docs/datadog.md`, and shown in the Integrations UI
      on creating a `DATADOG` integration) and pasted into Datadog's webhook config
      verbatim. Only `Triggered`/`Re-Triggered` transitions create an incident — others
      (`Recovered`, `Warn`, …) share the same `alert_id` (this incident's `externalId`) and
      resolve to the one already created rather than duplicating
- [x] `POST /api/webhooks/datadog/:integrationId` (same 202-then-async shape as every other
      webhook source), the Datadog Integration's `/test` route now calls the real
      `DatadogClient.validate()` (reused directly from `packages/map-servers`, exported
      alongside the provider) instead of "no real adapter yet"
- [x] **Closes the loop, using entirely pre-existing machinery**: a monitor firing →
      auto-created incident → auto-enqueued investigation (can use the Datadog Map Server's
      real metrics/logs as evidence, alongside anything else the org has connected) →
      RCA_COMPLETE → auto-enqueued remediation proposal → the existing policy engine decides
      whether it needs human approval or (only in `AUTONOMOUS` mode with an explicit `AUTO`
      policy for that capability, e.g. `mute_monitor`) executes unattended → verified before
      `RESOLVED`. No new orchestration code — the AUTO-mode pipeline already existed
      (Phase 8); this just gives it a real observability trigger instead of only a human
      filing a ticket
- [x] 33 new tests (`packages/map-servers`: 20, `packages/integrations`: 7, `apps/api`: 6) —
      full typecheck/lint/test green across the monorepo (366 tests total), plus a real
      `next build`

## Phase 10 — Mock providers
- [ ] Mock Map Servers: Databricks, Snowflake, Airflow, Azure, AWS, GCP, Kubernetes, Splunk, Dynatrace, New Relic (Datadog is now real — see the Interlude above)
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
