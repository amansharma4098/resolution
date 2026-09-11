# Deployment

Everything runs on Cloudflare — see ARCHITECTURE.md §2 for why, and for the platform gaps
that shaped this (D1's lack of interactive transactions, no native enum/JSON columns,
cross-site cookie `SameSite` requirements).

## Local development

Zero cloud accounts required — `wrangler dev` emulates the whole Workers + D1 runtime
locally via Miniflare:

```bash
npm install
cd apps/api && npx wrangler dev      # local Worker + local D1 emulation, no cloud needed
cd apps/web && npm run dev            # Next.js dev server
```

`MOCK_MODE=true` (default) runs the entire incident lifecycle against mock Map Servers and
a mock Jira — no external credentials needed. See `docs/map-server.md`.

For quick Node-side scripting against the schema (ad-hoc queries, one-off checks) outside
Wrangler, `packages/database`'s Prisma client also works against a plain local `file:`
SQLite URL with no driver adapter — only the deployed Worker needs
`packages/database/src/d1-client.ts`'s D1 adapter.

## Cloudflare resources (provisioned)

| Resource | Value |
|---|---|
| Pages project | `resolution` (Git-connected to `github.com/amansharma4098/resolution`, `main` branch) |
| Pages URL | `https://resolution-a7j.pages.dev` |
| Worker | `resolution-api` |
| Worker URL | `https://resolution-api.amansharma4098.workers.dev` |
| D1 database | `resolution-db` (28 tables) |
| R2 bucket | `resolution-storage` |
| Account ID | see `.env` (`CLOUDFLARE_ACCOUNT_ID`), not committed |

### apps/web (Cloudflare Pages)

Builds as a **static export** (`output: "export"` in `apps/web/next.config.js` — every
page is a client component with no SSR/middleware/dynamic routes, so this has no
behavioral effect) and deploys on every push to `main`. Build configuration on the Pages
project:

```
build command:    npm install && npm run build --workspace=@resolution/web
destination dir:   apps/web/out
root dir:          (repo root — required so npm workspaces resolve packages/*)
env var:            NEXT_PUBLIC_API_URL=https://resolution-api.amansharma4098.workers.dev
```

The project is **Git-connected**, not Direct Upload — that distinction matters because
Cloudflare does not allow converting one to the other after creation (confirmed via the
API: `"You cannot update the source object in a Direct Uploads project."`). If you ever
need to recreate it, create it *with* the `source` block already set — see the git history
of this file for the exact `curl` command used, or `action: read` this file's prior
version via the Artifact/API tooling.

### apps/api (Cloudflare Workers + D1)

```bash
cd apps/api
npx wrangler d1 create resolution-db          # one-time
npx wrangler d1 execute resolution-db --remote --file=../../packages/database/prisma/migrations/00000000000000_init/migration.sql
echo -n "<strong random value>" | npx wrangler secret put JWT_SECRET
echo -n "<openssl rand -base64 32>" | npx wrangler secret put ENCRYPTION_MASTER_KEY
echo -n "<sk-ant-...>" | npx wrangler secret put ANTHROPIC_API_KEY   # optional — omit to run this deployment on MOCK_MODE's LLM client
npx wrangler deploy
```

`wrangler.toml` holds the D1 binding (`DB`), the three Cloudflare Queue bindings
(`INCIDENT_INGESTION_QUEUE`, `INCIDENT_INVESTIGATION_QUEUE`, `INCIDENT_REMEDIATION_QUEUE` —
see ARCHITECTURE.md §10), and non-secret vars (`CORS_ORIGIN`, `SECRET_PROVIDER`,
`MOCK_MODE`, `NODE_ENV`, `ANTHROPIC_MODEL`) — safe to commit. `JWT_SECRET`,
`ENCRYPTION_MASTER_KEY` and `ANTHROPIC_API_KEY` are set via `wrangler secret put`
(encrypted server-side) and never appear in `wrangler.toml` or any committed file.
`CORS_ORIGIN` must match the Pages URL exactly, and the session cookie is set with
`SameSite=None; Secure` in production since Pages and the Worker are different sites (see
ARCHITECTURE.md §2).

**This project deploys `apps/api` manually, not via a Git-connected pipeline** — every
deployment in this repo's history was run by hand from `apps/api` (`npx wrangler deploy`),
not triggered by a push. Cloudflare's dashboard offers a separate "Connect to Git" option
under a Worker's own Settings → Build tab (distinct from, and independent of, the Pages
project's Git connection below) — if that ever gets connected for this Worker, it needs
explicit configuration for this being an npm-workspaces monorepo, or its deploy step fails
with `wrangler: not found` (the default deploy command, `npx wrangler deploy`, assumes a
local `wrangler` install that was never actually installed). If enabling it: set **Root
directory** to `apps/api` and **Deploy command** to `npm install && npx wrangler deploy` (a
self-contained install-then-deploy, rather than relying on the separate Build command step
carrying state over — that split failed silently in practice). A failing build here never
affects the live Worker either way; it only blocks *that pipeline* from ever having
successfully deployed anything.

`MOCK_MODE` in this deployment's `[vars]` is `"false"` — an `ANTHROPIC_API_KEY` secret is
set, so real incidents get a real, billed `claude-opus-5` investigation (packages/ai). Flip
`MOCK_MODE` back to `"true"` in `wrangler.toml` (and redeploy) to run this deployment on the
zero-cost mock client instead; local dev/CI always use `MOCK_MODE=true` regardless of this
deployment's setting, since they read their own `.env`/test env, not `wrangler.toml`.

Redeploying after a schema change: regenerate the migration
(`npx prisma migrate diff --from-empty --to-schema-datamodel=prisma/schema.prisma --script`
from `packages/database`), apply it with `wrangler d1 execute resolution-db --remote
--file=...`, then `wrangler deploy` from `apps/api`.

## Secrets

- Cloudflare API token: local `.env` only, gitignored. In CI/CD, store it as a repo/deploy
  secret (e.g. GitHub Actions secret `CLOUDFLARE_API_TOKEN`) for the Pages/Workers deploy
  step — never hardcode it in a workflow file.
- `JWT_SECRET` / `ENCRYPTION_MASTER_KEY`: set via `wrangler secret put`, never committed.
  Local dev falls back to fixed, public, clearly-insecure defaults (see `apps/api/src/env.ts`)
  — the same treatment for both, since both need *a* value to boot and neither default is
  safe to rely on outside local dev.
- Cloud `SecretProvider` adapters (AWS Secrets Manager / Azure Key Vault / GCP Secret
  Manager) are designed for but not implemented — see `docs/credentials.md`.
