import type { NormalizedIncident, Priority, Severity } from "@resolution/shared";

/**
 * Jira Cloud webhook payload shape for `jira:issue_created` / `jira:issue_updated` — see
 * https://developer.atlassian.com/cloud/jira/platform/webhooks/. Only the fields this
 * platform actually needs are typed; Jira sends much more.
 */
export interface JiraWebhookPayload {
  webhookEvent: string;
  issue: {
    id: string;
    key: string;
    fields: {
      summary: string;
      description?: unknown;
      status?: { name: string } | null;
      priority?: { name: string } | null;
      project: { key: string; name: string };
      created: string;
      updated: string;
    };
  };
}

/** Jira's priority names are the built-in defaults (Highest/High/Medium/Low/Lowest) —
 *  a customer can rename or add custom priorities, in which case this falls back to
 *  MEDIUM/P3 rather than guessing. That fallback is intentional, not a bug: never invent a
 *  severity/priority we don't have real signal for. */
const JIRA_PRIORITY_MAP: Record<string, { severity: Severity; priority: Priority }> = {
  Highest: { severity: "CRITICAL", priority: "P1" },
  High: { severity: "HIGH", priority: "P2" },
  Medium: { severity: "MEDIUM", priority: "P3" },
  Low: { severity: "LOW", priority: "P4" },
  Lowest: { severity: "LOW", priority: "P4" },
};

function extractPlainTextDescription(description: unknown): string {
  if (typeof description === "string") return description;
  if (description && typeof description === "object" && "content" in description) {
    // Minimal Atlassian Document Format (ADF) plain-text extraction — walks paragraph/text
    // nodes only; doesn't attempt full ADF rendering (tables, mentions, etc.).
    const walk = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === "text" && typeof n.text === "string") return n.text;
      if (Array.isArray(n.content)) return n.content.map(walk).join("");
      return "";
    };
    return walk(description);
  }
  return "";
}

/**
 * Maps a raw Jira webhook payload into the platform's normalized incident shape
 * (ARCHITECTURE.md §8) — organizationId/id are filled in by the caller (the webhook route),
 * not here, since this function has no tenant context of its own. `status` is always `NEW`
 * on ingestion regardless of Jira's own status — our incident lifecycle is owned by this
 * platform's state machine (Phase 6), not mirrored from the source; Jira's raw status is
 * kept in `metadata.jiraStatus` for reference/debugging, never used to drive our state.
 */
export function normalizeJiraWebhook(
  payload: JiraWebhookPayload,
): Omit<NormalizedIncident, "id" | "organizationId" | "createdAt"> | null {
  if (payload.webhookEvent !== "jira:issue_created" && payload.webhookEvent !== "jira:issue_updated") {
    return null;
  }
  const { issue } = payload;
  const priorityName = issue.fields.priority?.name;
  const mapped = (priorityName ? JIRA_PRIORITY_MAP[priorityName] : undefined) ?? {
    severity: "MEDIUM" as const,
    priority: "P3" as const,
  };

  return {
    externalId: issue.key,
    source: "JIRA",
    title: issue.fields.summary,
    description: extractPlainTextDescription(issue.fields.description),
    severity: mapped.severity,
    priority: mapped.priority,
    status: "NEW",
    service: issue.fields.project.name,
    metadata: {
      jiraIssueId: issue.id,
      jiraProjectKey: issue.fields.project.key,
      jiraStatus: issue.fields.status?.name ?? null,
      jiraPriorityRaw: priorityName ?? null,
      webhookEvent: payload.webhookEvent,
    },
  };
}
