# resolution

**AI Incident Resolution Platform** — a multi-tenant SaaS platform where an AI agent
connects to a customer's existing ITSM, monitoring, cloud, data and infrastructure systems
to investigate, diagnose, remediate and verify production incidents. Microsoft Fabric is
one of many supported integrations, not a hard dependency — customers configure which
systems they use from the UI, and new integrations plug in without touching the core
agent engine.

- **Architecture**: [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data model, API contracts, the
  Map Server interface, credential architecture, AI agent architecture.
- **Build plan & status**: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
- **Docs**: [`docs/`](./docs) — `map-server.md` (how to add an integration), `deployment.md`
  (Cloudflare + Neon + Upstash topology), more added per phase.

## Status

Phase 0 (foundation docs, repo, monorepo scaffold, Prisma schema, Cloudflare Pages + R2
provisioned) is complete. Everything else in `IMPLEMENTATION_PLAN.md` is in progress —
this is a large system being built incrementally, phase by phase; nothing is marked done
until it's real, tested, and (where genuinely mocked) labeled `MOCK` in the UI.

## Quick start (local, zero cloud accounts)

```bash
npm install
cp .env.example .env   # fill in local values; MOCK_MODE=true needs nothing else
npm run docker:up      # Postgres (pgvector) + Redis
npm run db:migrate
npm run dev
```

## Monorepo layout

```
apps/       web (Next.js) · api (Fastify) · worker (BullMQ consumers)
packages/   database · ai · agents · integrations · map-servers · credentials ·
            security · shared · ui
```
