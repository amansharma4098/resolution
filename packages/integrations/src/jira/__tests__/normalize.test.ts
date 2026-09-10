import { describe, expect, it } from "vitest";
import { normalizeJiraWebhook, type JiraWebhookPayload } from "../normalize";

function payload(overrides: Partial<JiraWebhookPayload["issue"]["fields"]> = {}): JiraWebhookPayload {
  return {
    webhookEvent: "jira:issue_created",
    issue: {
      id: "10002",
      key: "OPS-1",
      fields: {
        summary: "Pipeline failing overnight",
        description: "The nightly ETL pipeline is failing with a timeout",
        status: { name: "To Do" },
        priority: { name: "High" },
        project: { key: "OPS", name: "Operations" },
        created: "2026-01-01T00:00:00.000+0000",
        updated: "2026-01-01T00:00:00.000+0000",
        ...overrides,
      },
    },
  };
}

describe("normalizeJiraWebhook", () => {
  it("maps a created-issue webhook to a normalized incident", () => {
    const result = normalizeJiraWebhook(payload());
    expect(result).toMatchObject({
      externalId: "OPS-1",
      source: "JIRA",
      title: "Pipeline failing overnight",
      description: "The nightly ETL pipeline is failing with a timeout",
      severity: "HIGH",
      priority: "P2",
      status: "NEW",
      service: "Operations",
    });
    expect(result?.metadata.jiraStatus).toBe("To Do");
  });

  it("ignores webhook events it doesn't recognize", () => {
    expect(normalizeJiraWebhook({ ...payload(), webhookEvent: "jira:issue_deleted" })).toBeNull();
  });

  it("falls back to MEDIUM/P3 for an unrecognized (custom) priority name rather than guessing", () => {
    const result = normalizeJiraWebhook(payload({ priority: { name: "Bananas" } }));
    expect(result?.severity).toBe("MEDIUM");
    expect(result?.priority).toBe("P3");
  });

  it("handles a missing priority", () => {
    const result = normalizeJiraWebhook(payload({ priority: null }));
    expect(result?.severity).toBe("MEDIUM");
  });

  it("extracts plain text from an Atlassian Document Format description", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Root cause is unknown" }],
        },
      ],
    };
    const result = normalizeJiraWebhook(payload({ description: adf }));
    expect(result?.description).toBe("Root cause is unknown");
  });

  it("never fabricates a description when none is present", () => {
    const result = normalizeJiraWebhook(payload({ description: undefined }));
    expect(result?.description).toBe("");
  });
});
