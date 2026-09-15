# Similar past incident recall

The single most-copied feature across every AI incident-response competitor (incident.io's
Investigations/Nexus, Rootly's AI SRE, BigPanda's Incident Assistant, Resolve.ai) is "we've
seen this before, here's what fixed it." This is the honest, working version of that.

## How "similar" is decided

`packages/database/src/similarity.ts` scores every RESOLVED/CLOSED incident on the same
tenant against the incident being investigated:

| Signal | Weight |
|---|---|
| Same `service` | +3 |
| Same `affectedSystem` | +2 |
| Same `source` | +1 |
| Each shared significant word in the title (stopwords/short tokens excluded) | +2 each |

This is deterministic, explainable attribute + keyword overlap — **not** a vector/embedding
search, and never labeled as one. Every match names exactly which signals fired
(`matchedOn: ["service", "keyword:disk"]`) rather than presenting an unexplained score. It's
designed to be swapped for real embedding search once the Knowledge base (`KnowledgeDocument`/
`KnowledgeEmbedding`, Phase 7, not yet built) ships — `IncidentRepository.findSimilarResolved`
is the one place that would change.

Candidates are bounded to the 200 most recent resolved/closed incidents per tenant (real
work, not `O(all incidents ever)`), and a candidate must score above 0 to ever be surfaced —
nothing is shown "because it's recent" alone.

## Where it shows up

Three places, all backed by the same `findSimilarIncidentSummaries` (`apps/api/src/lib/
similar-incidents.ts`), which attaches each match's actual root cause, the remediation
action taken, and its outcome (`succeeded` / `failed` / `rolled_back` / `not attempted` —
read straight off `RootCauseAnalysis`/`Resolution`/`RemediationAction`, never fabricated):

1. **Investigation agent** (`packages/agents/src/investigation/investigation-agent.ts`) —
   every investigation gets the top 3 similar past incidents injected into its system prompt
   automatically, framed explicitly as *"a useful starting hypothesis, but you must still
   confirm or rule it out using your tools before citing it as a FACT"* — precedent, not proof.
2. **`find_similar_incidents` tool** — in the shared tool catalog (`apps/api/src/lib/
   incident-tools.ts`), so it's available on demand through both Chat and the MCP server,
   same as every other incident tool.
3. **Incident detail page** — a "Similar past incidents" card, shown whenever at least one
   match exists, right below the root cause analysis.

## Testing

- `packages/database/src/__tests__/similarity.test.ts` — the scoring/ranking function in
  isolation (no DB).
- `packages/agents/src/investigation/__tests__/investigation-agent.test.ts` — the system
  prompt includes similar incidents when given, omits the section entirely when there are
  none, and always carries the verify-before-trusting caveat.
- `apps/api/src/__tests__/similar-incidents.test.ts` — end-to-end: a seeded resolved incident
  with a real RCA/resolution/remediation-action shows up correctly on `GET /api/incidents/:id`
  and via the `find_similar_incidents` MCP tool; an unrelated incident never matches; another
  tenant's history is never visible.
