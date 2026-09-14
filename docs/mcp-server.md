# MCP (Model Context Protocol)

Two independent, unrelated features share the "MCP" name here — this platform both
*consumes* other MCP servers and *is* one itself.

## 1. Consuming an org's MCP server (a generic Map Server connector)

Instead of a hand-built `packages/map-servers/<vendor>/` folder per integration
(`docs/map-server.md`'s seven-piece pattern), an org can point Resolution at *any* MCP
server it already runs — internal tools, or a public one (GitHub, Postgres, Grafana, …) —
and every tool that server exposes becomes a usable capability, subject to the exact same
enable/policy/audit discipline as a hand-built provider's capabilities.

- **Where it lives**: `packages/map-servers/src/mcp/` — a Workers-native JSON-RPC client
  (`client.ts`, plain `fetch`, no SDK — the official `@modelcontextprotocol/sdk` targets
  Node, not a Cloudflare Worker), a best-effort JSON Schema → Zod converter
  (`json-schema-to-zod.ts`), and the `mcpProvider: MapServerProvider` itself
  (`provider.ts`).
- **Config**: `{ url: string, headers?: Record<string, string> }` — the org's MCP server
  endpoint plus any extra static headers it needs.
- **Auth**: `TOKEN`/`API_KEY`/`CUSTOM` credential → sent as `Authorization: Bearer <token>`.
  **Not supported yet**: OAuth / dynamic client registration, which a growing share of
  public hosted MCP servers require — self-hosted/internal servers (the likely first use
  case) work fine with a static token today; OAuth is tracked as a follow-up.
- **Discovery is live, not static**: every other provider's `capabilities` array is fixed
  at registration time; this one is always `[]` and implements `discoverCapabilities`
  instead (`packages/map-servers/src/types.ts`'s comment on that field) — called by
  `POST /api/map-servers/:id/refresh-capabilities` (admin-only, requires a credential
  already attached) to (re-)discover the server's current tools and persist them as
  `MapServerCapability` rows, same `enabled: false` by default as creation elsewhere. A key
  the server no longer reports is left alone rather than deleted (non-destructive sync —
  `MapServerRepository.syncCapabilitiesFromProvider`'s comment).
- **Risk defaults**: MCP has no concept of risk level or mutating-ness. A discovered tool
  gets `LOW`/non-mutating only if the server declares `annotations.readOnlyHint: true` on
  it (a hint the MCP spec itself says not to fully trust) — everything else, including a
  server with no annotations at all, defaults to `HIGH`/mutating, so it's
  automation-policy-gated and never runs unattended until an admin reviews and enables it.

## 2. Being an MCP server (exposing incident data to an external client)

`POST /api/mcp` lets your own MCP client — Claude Desktop, another agent — ask about
incidents without opening the dashboard, the mirror image of §1.

- **Auth**: a bearer API key, not the browser session cookie (an external MCP client can't
  hold a cookie). Create one under **API Keys** in the dashboard (personal to your account,
  not tied to one organization) — shown once at creation, never retrievable again. Point
  your MCP client at `<API base URL>/api/mcp` with `Authorization: Bearer <key>`.
- **Tools** (all read-only — see below): `list_incidents`, `get_incident`, `get_rca`. Each
  takes an `tenantId` argument; the server checks you're actually a member of that
  organization on every call (same membership check as the dashboard, not a role check — a
  MEMBER can use these the same as an OWNER, since they're read-only). A non-member gets
  "not found," never "forbidden" — org existence isn't disclosed to someone with no access.
- **Deliberately read-only for this first pass**: no tool can trigger an investigation or a
  remediation. Doing that would mean routing a tool call through the same
  policy-engine/human-approval gating every other mutating action goes through
  (ARCHITECTURE.md §7) — real scope, tracked as a follow-up, not implied by adding a tool
  here.
- **Implementation**: `apps/api/src/routes/mcp.ts` (the JSON-RPC dispatcher) and
  `apps/api/src/routes/api-keys.ts` (key management) +
  `apps/api/src/middleware/authenticate-api-key.ts` (bearer-token auth, the non-cookie
  counterpart to `authenticate.ts`).
