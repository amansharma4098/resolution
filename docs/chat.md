# Chat assistant

`POST /api/chat` (and `apps/web`'s `/dashboard/chat` page) is an in-app conversational
assistant, built on the exact same tool catalog `POST /api/mcp` exposes to external MCP
clients — see `docs/mcp-server.md`. The two entry points share one implementation
(`apps/api/src/lib/incident-tools.ts`): list/get incidents, get RCA, trigger an
investigation, propose a remediation, and approve/reject one.

## What's different from the MCP server

- **Auth**: the browser session cookie, not a bearer API key — this is a dashboard feature,
  reached from inside the product.
- **Scoping**: the chat is scoped to whichever organization is currently selected in the
  dashboard (the same `X-Tenant-Id` header every other route reads). The model is
  never shown `tenantId` as a tool argument it has to supply — the server strips it
  from the tool schemas it hands the model and injects the real one on every call,
  overriding anything the model puts there. One less thing that can go wrong from a model
  hallucinating or mistyping an id.
- **Presentation**: `list_incidents` results are grouped and rendered by `source` (which
  connected platform each incident came from) in the chat transcript, not just described in
  text.

## Resolving through chat

Ask it to "resolve" an incident and it follows the same lifecycle the dashboard's buttons
drive: check status → investigate if needed → propose a remediation once the RCA is
complete → ask before approving. It never names or picks a specific system to fix things
with — `propose_remediation` already has the Resolution Agent auto-select whichever
connected Map Server (including any org-configured MCP server —
`packages/map-servers/src/mcp`) can actually perform the fix, the same as approving a
remediation from the incident detail page.

Investigation can run asynchronously in production (a real Cloudflare Queue, not the
synchronous stand-in local dev/tests use) — if you ask it to resolve something right after
triggering an investigation, it may report the RCA isn't ready yet rather than a
remediation proposal. That's the same state-machine guard the dashboard has, not a bug.

## MOCK_MODE

With no `ANTHROPIC_API_KEY` configured, the chat uses a dedicated mock
(`packages/ai/src/mock-chat-client.ts`) that explains it can't reason about messages yet,
rather than a canned tool call — reasoning about a free-form message is exactly the part
that needs a real model; faking that would misrepresent it as working. The tool-calling
loop and every tool it can call are fully real regardless.

## Implementation

- `apps/api/src/lib/incident-tools.ts` — the shared tool catalog + execution, used by both
  `routes/mcp.ts` and `routes/chat.ts`.
- `apps/api/src/routes/chat.ts` — the manual tool-calling loop (mirrors
  `packages/agents/src/investigation/investigation-agent.ts`'s reasoning for why this is
  hand-written rather than the Anthropic SDK's Tool Runner), bounded to 10 iterations per
  turn.
- `apps/web/app/dashboard/chat/page.tsx` — the UI. Conversation history is the raw message
  array the server returns (including tool_use/tool_result blocks), kept client-side and
  replayed in full on the next turn — there's no server-side chat-thread storage yet.
