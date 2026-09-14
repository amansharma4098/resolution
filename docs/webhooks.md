# Webhook connectors

Three incident sources send events in via a webhook today: `JIRA`, `SERVICENOW`, and the
generic `WEBHOOK` type. All three share the same shape at the transport level
(`POST /api/webhooks/<type>/:integrationId`, `X-Webhook-Secret` header, 202 immediately,
real work happens off-queue — ARCHITECTURE.md §10) and differ only in what body they expect.

## Jira / ServiceNow

Their own native webhook payload — see `packages/integrations/src/jira/normalize.ts` and
`.../servicenow/normalize.ts`. Nothing to configure beyond pointing the source system's
outgoing webhook at the URL and secret shown once at integration-creation time.

## Generic webhook

For anything without a bespoke connector — an in-house tool, a script, a monitoring system
with a configurable webhook body. Create an integration with `type: "WEBHOOK"` to get a URL
and secret, then `POST` this shape to it (`packages/integrations/src/webhook/normalize.ts`):

```json
{
  "externalId": "your-own-idempotency-key",
  "title": "Disk usage above 95%",
  "description": "optional",
  "severity": "CRITICAL | HIGH | MEDIUM | LOW",
  "priority": "P1 | P2 | P3 | P4",
  "service": "optional",
  "environment": "optional",
  "resource": "optional",
  "metadata": {}
}
```

Only `externalId` and `title` are required; the rest default (`severity: MEDIUM`,
`priority: P3`, `description: ""`, `metadata: {}`).

- **`externalId` is required, not generated** — it's what makes a redelivery idempotent
  (`Incident`'s unique `(organizationId, source, externalId)`, same as Jira's issue key or
  ServiceNow's incident number). Send a stable id from your own system, or replays will
  create duplicate incidents.
- **Validated synchronously, not just enqueued** — unlike Jira/ServiceNow (whose shape is a
  documented third party's, so an event type this platform doesn't handle is expected and
  silently ignored downstream), a caller integrating directly against *this* schema gets an
  immediate `400` with field-level detail for a malformed payload rather than a `202` that
  silently produces nothing.
- **Nothing to "test"** — the Integrations page's Test button reports this honestly (there's
  no outbound connection or credential for a purely inbound webhook to verify), rather than
  a misleading `DISCONNECTED`.
