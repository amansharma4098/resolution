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
      `organizationId`), same 16 tests passing unmodified in behavior
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
