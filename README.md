# resolution

**AI Incident Resolution Platform** — a multi-tenant SaaS platform where an AI agent
connects to a customer's existing ITSM, monitoring, cloud, data and infrastructure systems
to investigate, diagnose, remediate and verify production incidents. Microsoft Fabric is
one of many supported integrations, not a hard dependency — customers configure which
systems they use from the UI, and new integrations plug in without touching the core
agent engine.

Runs entirely on Cloudflare: Pages (frontend), Workers (API), D1 (database), R2 (files).
See `ARCHITECTURE.md` §2 for why and what that trades off.

- **Architecture**: [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data model, API contracts, the
  Map Server interface, credential architecture, AI agent architecture.
- **Build plan & status**: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
- **Docs**: [`docs/`](./docs) — `map-server.md` (how to add an integration), `deployment.md`
  (the Cloudflare-only deploy flow), more added per phase.
- **Live**: `apps/web` → https://resolution-a7j.pages.dev · `apps/api` →
  https://resolution-api.amansharma4098.workers.dev

## Status

Phases 0–2 complete (foundation, auth/orgs/RBAC/tenant isolation, configuration system —
encrypted credentials, Map Server registry, Map Server + Integration config), followed by a
full migration off the original hybrid (Postgres/Redis-on-a-Node-host) hosting decision
onto Cloudflare-only (D1, Workers, Web Crypto) — see `IMPLEMENTATION_PLAN.md`'s "Interlude"
entry. Phases 3–8 also complete: real Jira/ServiceNow/Fabric integrations, incident ingestion via
real Cloudflare Queues, a real AI Investigation/RCA agent (`claude-opus-5`, tool-calling,
evidence-cited root cause analysis), and a real Remediation pipeline (policy engine,
approval flow, remediation execution, verification) — all with a genuine `MOCK_MODE`
fallback that needs zero credentials. Everything else in `IMPLEMENTATION_PLAN.md` is in
progress — this is a large system being built incrementally, phase by phase; nothing is
marked done until it's real, tested, and (where genuinely mocked) labeled `MOCK` in the UI.

## Quick start (local, zero cloud accounts)

```bash
npm install
cp .env.example .env    # MOCK_MODE=true needs nothing else
cd apps/api && npx wrangler dev    # local Worker + local D1 emulation (Miniflare)
cd apps/web && npm run dev          # Next.js dev server
```

## Monorepo layout

```
apps/       web (Next.js, static export → CF Pages) ·
            api (Hono → CF Worker — HTTP + Cloudflare Queue consumers, one deployment)
packages/   database (Prisma → D1) · ai · agents · integrations · map-servers ·
            credentials · security · shared · ui
```
