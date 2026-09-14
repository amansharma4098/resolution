# Datadog — real observability, closing the loop into auto-resolution

Datadog is wired into this platform two separate ways, matching the existing
Integration/Map Server split (`ARCHITECTURE.md` §1/§4). An org typically configures both,
pointing at the same Datadog account:

## 1. Map Server — real observability data + remediation

`packages/map-servers/src/datadog` (`MapServerType: DATADOG`) — the second real Map Server
after Fabric, not mocked. Auth is a `CUSTOM` credential with `apiKey`/`applicationKey`
fields (Datadog's own two-key auth, which doesn't fit any single-secret
`AuthenticationType`). Config: `{ site }`, defaulting to `datadoghq.com` (override for the
EU site, `us3`, etc.).

Capabilities:

| key | mutating | risk | what it does |
|---|---|---|---|
| `get_monitor` | no | LOW | a monitor's current state, query, mute status |
| `list_monitors` | no | LOW | monitors, optionally tag-filtered |
| `query_metrics` | no | LOW | a metric time series — real evidence for an investigation |
| `search_logs` | no | LOW | a log search — real evidence |
| `mute_monitor` | **yes** | MEDIUM | silence a noisy/flapping monitor during a known issue |
| `unmute_monitor` | yes | LOW | restore normal alerting |

`mute_monitor` has a `verification` spec (re-reads the monitor via `get_monitor` and checks
`silenced`, never trusting the mutation call's own response alone — ARCHITECTURE.md §6).
Like every Map Server, none of these run until an admin explicitly enables the capability
and — for the mutating ones — the policy engine allows it (ARCHITECTURE.md §7); nothing
here is auto-executed just because the provider is real.

## 2. Integration — auto-alerting (a monitor firing creates an incident)

`packages/integrations/src/datadog` (`IncidentSourceType: DATADOG`) — this is the
"observability platform" half: a Datadog Monitor transitioning to `Triggered` (or
`Re-Triggered`) calls `POST /api/webhooks/datadog/:integrationId` and a real `Incident` is
created, same ingestion pipeline as Jira/ServiceNow (`ARCHITECTURE.md` §10 — 202
immediately, real work off-queue). Other transitions (`Recovered`, `Warn`, `No Data`, …)
update nothing — they share the same `alert_id`, which is this incident's `externalId`, so
they resolve to the incident already created rather than creating duplicates.

Unlike Jira/ServiceNow, Datadog's webhook body isn't a shape it sends — Datadog's Webhooks
integration lets you type a JSON *template* with `$VARIABLE` tokens, and Datadog
substitutes and POSTs it. Paste this exact template into Datadog's webhook payload field
(the Integrations page shows this too when you create a `DATADOG` integration):

```json
{
  "alert_id": "$ALERT_ID",
  "alert_transition": "$ALERT_TRANSITION",
  "alert_title": "$ALERT_TITLE",
  "alert_query": "$ALERT_QUERY",
  "event_msg": "$EVENT_MSG",
  "priority": "$ALERT_PRIORITY",
  "host": "$HOSTNAME",
  "tags": "$TAGS",
  "link": "$LINK"
}
```

Then add the webhook as a notification target on any monitor (e.g.
`@webhook-resolution` in the monitor's message). `priority` (`P1`–`P5`) maps to
Resolution's `Severity`/`Priority`; `service`/`env` are pulled from Datadog's own
`key:value` tag format when present.

## Closing the loop: observability → auto-resolution

Nothing new was needed for this part — it's the existing pipeline, just now reachable from
a real alert instead of only a human filing a Jira ticket:

```
Datadog monitor fires (Triggered)
  → webhook → Incident created (NEW)
  → auto-enqueued investigation (packages/agents' Investigation Agent), which can use the
    Datadog Map Server's query_metrics/search_logs/get_monitor as real evidence, plus
    anything else the org has connected (Kubernetes, Fabric, …)
  → RCA_COMPLETE → auto-enqueued remediation proposal
  → the policy engine (ARCHITECTURE.md §7) decides per org resolutionMode + per-capability
    AutomationPolicy: OBSERVE_ONLY/RECOMMEND/HUMAN_APPROVED cap at human approval; only an
    org in AUTONOMOUS mode with an explicit AUTO policy for the proposed capability
    (e.g. mute_monitor) executes unattended
  → Verification re-reads real state (get_monitor) before the incident is marked RESOLVED
```

An org that wants real "alert fires → AI investigates and fixes it, unattended" needs three
things configured, all pre-existing: `resolutionMode: AUTONOMOUS` on the organization, an
`AutomationPolicy` row with `behavior: AUTO` for the specific capability the agent should be
allowed to run unattended, and that capability actually enabled on its Map Server. Anything
less conservative than that still investigates and proposes automatically, just stops for a
human to approve before executing.
