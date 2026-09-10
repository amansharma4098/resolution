import type { NormalizedIncident, Priority, Severity } from "@resolution/shared";

/**
 * Unlike Jira, ServiceNow has no single standard "incident webhook" payload — outbound
 * notification is whatever a customer's own Business Rule / Flow Designer action is
 * configured to send. This is the payload shape this platform documents and expects a
 * customer to configure their outbound REST call to send (mirroring the incident table's
 * own field names, so it's a near-direct passthrough on their end): a Business Rule on
 * the `incident` table, triggered on insert/update, POSTing these fields as JSON to
 * `/api/webhooks/servicenow/:integrationId` with the `X-Webhook-Secret` header set.
 */
export interface ServiceNowWebhookPayload {
  sys_id: string;
  number: string;
  short_description: string;
  description?: string;
  priority?: string; // "1 - Critical" .. "5 - Planning"
  state?: string;
  category?: string;
  assignment_group?: string;
}

/** ServiceNow's out-of-the-box priority choice list. A customer can add custom priority
 *  values, in which case this falls back to MEDIUM/P3 rather than guessing — same
 *  discipline as the Jira priority map. */
const SERVICENOW_PRIORITY_MAP: Record<string, { severity: Severity; priority: Priority }> = {
  "1 - Critical": { severity: "CRITICAL", priority: "P1" },
  "2 - High": { severity: "HIGH", priority: "P2" },
  "3 - Moderate": { severity: "MEDIUM", priority: "P3" },
  "4 - Low": { severity: "LOW", priority: "P4" },
  "5 - Planning": { severity: "LOW", priority: "P4" },
};

/**
 * Maps a ServiceNow incident payload into the platform's normalized incident shape
 * (ARCHITECTURE.md §8). Like the Jira adapter, `status` is always `NEW` on ingestion —
 * this platform's own state machine owns the lifecycle, never mirrors the source system's
 * status; ServiceNow's raw `state` is kept in `metadata.serviceNowState` for reference.
 */
export function normalizeServiceNowWebhook(
  payload: ServiceNowWebhookPayload,
): Omit<NormalizedIncident, "id" | "organizationId" | "createdAt"> {
  const mapped = (payload.priority ? SERVICENOW_PRIORITY_MAP[payload.priority] : undefined) ?? {
    severity: "MEDIUM" as const,
    priority: "P3" as const,
  };

  return {
    externalId: payload.number,
    source: "SERVICENOW",
    title: payload.short_description,
    description: payload.description ?? "",
    severity: mapped.severity,
    priority: mapped.priority,
    status: "NEW",
    service: payload.category,
    metadata: {
      serviceNowSysId: payload.sys_id,
      serviceNowState: payload.state ?? null,
      serviceNowPriorityRaw: payload.priority ?? null,
      assignmentGroup: payload.assignment_group ?? null,
    },
  };
}
