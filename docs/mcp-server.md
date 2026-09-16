# MCP (Model Context Protocol)

Two independent, unrelated features share the "MCP" name here — this platform both
_consumes_ other MCP servers and _is_ one itself.

## 1. Tenant-owned remote MCP connections

In **Connections**, choose **MCP Server**, select a vault credential and enter a public HTTPS URL.
Only `url` is accepted in creation config. Tokens belong in Credentials, never in headers or URLs.
Static TOKEN/API_KEY/CUSTOM bearer credentials are supported; OAuth and private connectors are pending.

Test connectivity, then **Discover tools**. Review the displayed descriptions and parameters,
select READ or WRITE, and enable each approved tool. All discovered tools start disabled and
HIGH/mutating; server read-only hints do not grant authority. The server binds review to the
exact definition fingerprint. A changed definition blocks execution until rediscovery and review.
Refreshing disables discovered tools so permissions cannot silently carry across changes.

`PATCH /api/map-servers/:id` with `{ disabled: true }` disables a connection.
`PATCH /api/map-servers/:id/capabilities/:key` accepts `{ enabled, access?, fingerprint? }`;
MCP enablement requires READ/WRITE and the fingerprint returned by discovery. These writes require
ADMIN or OWNER in the current tenant. Agent execution rechecks connection, credential and policy.

The client supports protocol 2025-06-18, paginated tool listing, JSON and bounded SSE responses,
with a 15-second request timeout and 2 MB response limit. Redirects are blocked. This is not a
universal guarantee of compatibility with every MCP server. See `saas-release.md` for limitations.

## 2. Being an MCP server (exposing incident data to an external client)

`POST /api/mcp` lets your own MCP client — Claude Desktop, another agent — ask about
incidents without opening the dashboard, the mirror image of §1.

- **Auth**: a bearer API key, not the browser session cookie (an external MCP client can't
  hold a cookie). Create one under **API Keys** in the dashboard (personal to your account,
  not tied to one organization) — shown once at creation, never retrievable again. Point
  your MCP client at `<API base URL>/api/mcp` with `Authorization: Bearer <key>`.
- **Tools**: incident lookup, RCA, similar incidents, investigation, remediation proposals, approvals and postmortems. Each
  takes an `tenantId` argument; the server checks you're actually a member of that
  organization on every call (same membership check as the dashboard, not a role check — a
  MEMBER can use these the same as an OWNER, since they're read-only). A non-member gets
  "not found," never "forbidden" — org existence isn't disclosed to someone with no access.
- **Writes**: investigation and remediation require the applicable tenant role. Approval
  decisions require ADMIN or OWNER and current execution policy. Unlike in-app chat, an external
  MCP client can explicitly invoke the approval tool with its authenticated identity.
- **Implementation**: `apps/api/src/routes/mcp.ts` (the JSON-RPC dispatcher) and
  `apps/api/src/routes/api-keys.ts` (key management) +
  `apps/api/src/middleware/authenticate-api-key.ts` (bearer-token auth, the non-cookie
  counterpart to `authenticate.ts`).
