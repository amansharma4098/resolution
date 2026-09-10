import { describe, expect, it } from "vitest";
import { normalizeServiceNowWebhook, type ServiceNowWebhookPayload } from "../normalize";

function payload(overrides: Partial<ServiceNowWebhookPayload> = {}): ServiceNowWebhookPayload {
  return {
    sys_id: "abc123",
    number: "INC0010042",
    short_description: "Payment API returning 500s",
    description: "Elevated error rate since the last deploy",
    priority: "2 - High",
    state: "1",
    category: "Software",
    ...overrides,
  };
}

describe("normalizeServiceNowWebhook", () => {
  it("maps an incident payload to a normalized incident", () => {
    const result = normalizeServiceNowWebhook(payload());
    expect(result).toMatchObject({
      externalId: "INC0010042",
      source: "SERVICENOW",
      title: "Payment API returning 500s",
      description: "Elevated error rate since the last deploy",
      severity: "HIGH",
      priority: "P2",
      status: "NEW",
      service: "Software",
    });
    expect(result.metadata.serviceNowSysId).toBe("abc123");
    expect(result.metadata.serviceNowState).toBe("1");
  });

  it("falls back to MEDIUM/P3 for an unrecognized priority rather than guessing", () => {
    const result = normalizeServiceNowWebhook(payload({ priority: "0 - Custom" }));
    expect(result.severity).toBe("MEDIUM");
    expect(result.priority).toBe("P3");
  });

  it("handles a missing priority", () => {
    const result = normalizeServiceNowWebhook(payload({ priority: undefined }));
    expect(result.severity).toBe("MEDIUM");
  });

  it("never fabricates a description when none is present", () => {
    const result = normalizeServiceNowWebhook(payload({ description: undefined }));
    expect(result.description).toBe("");
  });

  it("maps the full priority range correctly", () => {
    expect(normalizeServiceNowWebhook(payload({ priority: "1 - Critical" })).severity).toBe("CRITICAL");
    expect(normalizeServiceNowWebhook(payload({ priority: "4 - Low" })).severity).toBe("LOW");
    expect(normalizeServiceNowWebhook(payload({ priority: "5 - Planning" })).priority).toBe("P4");
  });
});
