import type { NormalizedIncident, Priority, Severity } from "@resolution/shared";

/**
 * Unlike Jira/ServiceNow, Datadog's webhook body isn't a fixed shape it sends — Datadog's
 * Webhooks integration lets the customer type an arbitrary JSON *template* into Datadog's
 * UI, using Datadog's own `$VARIABLE` substitution tokens, and POSTs whatever string that
 * template renders to. Resolution defines the template it expects (documented in
 * docs/webhooks.md) and the customer pastes it into Datadog's webhook payload field
 * verbatim — Datadog does the substitution before it ever reaches us. This type describes
 * the JSON *after* that substitution has happened.
 */
export interface DatadogWebhookPayload {
  alert_id: string;
  alert_transition: string; // "Triggered" | "Re-Triggered" | "Recovered" | "Warn" | "No Data" | ...
  alert_title: string;
  alert_query?: string;
  event_msg?: string;
  priority?: string; // "P1".."P5", or "" if the monitor has no priority set
  host?: string;
  tags?: string; // comma-separated "key:value" pairs, Datadog's own tag format
  link?: string;
}

const DATADOG_PRIORITY_MAP: Record<string, { severity: Severity; priority: Priority }> = {
  P1: { severity: "CRITICAL", priority: "P1" },
  P2: { severity: "HIGH", priority: "P2" },
  P3: { severity: "MEDIUM", priority: "P3" },
  P4: { severity: "LOW", priority: "P4" },
  P5: { severity: "LOW", priority: "P4" }, // Resolution's own scale tops out at P4
};

/** Pulls a `key:value` tag's value out of Datadog's comma-separated tag string — e.g.
 *  `tagValue("env:prod,service:checkout,team:payments", "service")` → `"checkout"`. */
function tagValue(tags: string | undefined, key: string): string | undefined {
  if (!tags) return undefined;
  for (const tag of tags.split(",")) {
    const [k, ...rest] = tag.trim().split(":");
    if (k === key && rest.length > 0) return rest.join(":");
  }
  return undefined;
}

/**
 * Maps a rendered Datadog webhook payload into the platform's normalized incident shape —
 * tenantId/id are filled in by the caller (the webhook route), same as every other
 * normalizer. Only the `Triggered`/`Re-Triggered` transitions create/matter here: a
 * `Recovered`/`Warn`/`No Data` transition for the same monitor arrives as a *separate*
 * webhook call sharing the same `alert_id` — since `alert_id` is this incident's
 * `externalId`, and Incident dedup is keyed on `(tenantId, source, externalId)`
 * (IncidentRepository.findByExternalId), a later transition just resolves to the incident
 * `Triggered` already created rather than creating a duplicate; returning `null` here for
 * transitions that aren't a real page keeps them from creating one in the first place.
 */
export function normalizeDatadogWebhook(
  payload: DatadogWebhookPayload,
): Omit<NormalizedIncident, "id" | "tenantId" | "createdAt"> | null {
  if (payload.alert_transition !== "Triggered" && payload.alert_transition !== "Re-Triggered") {
    return null;
  }

  const mapped = (payload.priority ? DATADOG_PRIORITY_MAP[payload.priority] : undefined) ?? {
    severity: "MEDIUM" as const,
    priority: "P3" as const,
  };

  return {
    externalId: payload.alert_id,
    source: "DATADOG",
    title: payload.alert_title,
    description: payload.event_msg || payload.alert_query || "",
    severity: mapped.severity,
    priority: mapped.priority,
    status: "NEW",
    service: tagValue(payload.tags, "service"),
    environment: tagValue(payload.tags, "env"),
    resource: payload.host,
    metadata: {
      datadogAlertId: payload.alert_id,
      datadogAlertTransition: payload.alert_transition,
      datadogAlertQuery: payload.alert_query ?? null,
      datadogPriorityRaw: payload.priority ?? null,
      datadogTags: payload.tags ?? null,
      datadogLink: payload.link ?? null,
    },
  };
}
