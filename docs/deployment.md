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
| Pages project | `resolution` |
| Pages URL | `https://resolution-a7j.pages.dev` |
| R2 bucket | `resolution-storage` |
| Account ID | see `.env` (`CLOUDFLARE_ACCOUNT_ID`), not committed |

Created via the Cloudflare API using the token in `.env` (`CLOUDFLARE_API_TOKEN`, never
committed — see `.gitignore` and `.env.example` for the shape). To reprovision or extend:

```bash
source .env
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"resolution","production_branch":"main"}'
```

`apps/web` deploys to Cloudflare Pages (Next.js static/edge output). `apps/api` and
`apps/worker` need a persistent Node process (Prisma connection pool, raw TCP to Redis for
BullMQ) and are **not** deployed to Cloudflare Pages/Workers — they run on a Node-capable
host (Railway, Fly.io, or Render are all fine; none is provisioned yet, pending your
choice and credentials).

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
