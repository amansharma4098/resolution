# Deployment

See ARCHITECTURE.md §2 for why this is a hybrid topology rather than a pure Cloudflare
stack: the spec requires Postgres+pgvector and Redis+BullMQ, which Cloudflare's native
Workers/D1/Queues runtime doesn't support (no raw long-running Node processes, no pgvector).

## Local development

Zero cloud accounts required:

```bash
npm install
npm run docker:up        # Postgres (pgvector image) + Redis on localhost
npm run db:migrate        # applies packages/database/prisma/migrations/*
npm run dev                # turbo runs apps/web, apps/api, apps/worker together
```

`MOCK_MODE=true` (default in `.env.example`) runs the entire incident lifecycle against
mock Map Servers and a mock Jira — no external credentials needed. See `docs/map-server.md`.

## Cloudflare resources (provisioned)

| Resource | Value |
|---|---|
| Pages project | `resolution` (Git-connected to `github.com/amansharma4098/resolution`, `main` branch) |
| Pages URL | `https://resolution-a7j.pages.dev` |
| R2 bucket | `resolution-storage` |
| Account ID | see `.env` (`CLOUDFLARE_ACCOUNT_ID`), not committed |

`apps/web` builds as a **static export** (`output: "export"` in `apps/web/next.config.js`
— every page is a client component with no SSR/middleware/dynamic routes, so this has no
behavioral effect) and deploys to Cloudflare Pages on every push to `main`. Build
configuration on the Pages project:

```
build command:    npm install && npm run build --workspace=@resolution/web
destination dir:   apps/web/out
root dir:          (repo root — required so npm workspaces resolve packages/*)
```

The project is **Git-connected**, not Direct Upload — that distinction matters because
Cloudflare does not allow converting one to the other after creation (confirmed via the API:
`"You cannot update the source object in a Direct Uploads project."`). If you ever need to
recreate it, create it *with* the `source` block already set, e.g.:

```bash
source .env
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{
    "name": "resolution",
    "production_branch": "main",
    "source": {
      "type": "github",
      "config": {
        "owner": "amansharma4098", "owner_id": "62933546",
        "repo_name": "resolution", "repo_id": "1364544687",
        "production_branch": "main", "deployments_enabled": true,
        "production_deployments_enabled": true, "preview_deployment_setting": "all",
        "preview_branch_includes": ["*"], "preview_branch_excludes": [],
        "path_includes": ["*"], "path_excludes": []
      }
    },
    "build_config": {
      "build_command": "npm install && npm run build --workspace=@resolution/web",
      "destination_dir": "apps/web/out", "root_dir": ""
    }
  }'
```

(The GitHub App backing Cloudflare Pages was already installed and authorized for this
GitHub account from other projects, so no interactive GitHub OAuth step was needed here —
that won't be true on a fresh account/repo.)

`apps/api` and `apps/worker` need a persistent Node process (Prisma connection pool, raw
TCP to Redis for BullMQ) and are **not** deployed to Cloudflare Pages/Workers — they run on
a Node-capable host (Railway, Fly.io, or Render are all fine; none is provisioned yet,
pending your choice and credentials).

## Production data stores (not yet provisioned — need your credentials)

- **Neon Postgres** (`NEON_DATABASE_URL`) — serverless Postgres with the `pgvector`
  extension for `KnowledgeEmbedding`. Create a project at neon.tech, enable `pgvector`, run
  `npm run db:migrate` against it.
- **Upstash Redis** (`UPSTASH_REDIS_URL`) — BullMQ backend. Create a database at
  upstash.com (TCP/Redis mode, not the REST-only free tier, since BullMQ needs a real Redis
  protocol connection).

Once you have both, set them in the Node host's environment (not in Cloudflare — Cloudflare
only holds the Pages/R2/DNS pieces) and point `DATABASE_URL`/`REDIS_URL` at them.

## Secrets

- Cloudflare API token: local `.env` only, gitignored. In CI/CD, store it as a repo/deploy
  secret (e.g. GitHub Actions secret `CLOUDFLARE_API_TOKEN`) for the Pages deploy step —
  never hardcode it in a workflow file.
- Application secrets (`ENCRYPTION_MASTER_KEY`, `JWT_SECRET`, provider credentials
  encrypted via `SecretProvider`) live in the Node host's secret manager or a cloud
  `SecretProvider` implementation (AWS Secrets Manager / Azure Key Vault / GCP Secret
  Manager) per `docs/credentials.md` — never in Cloudflare, never committed.
