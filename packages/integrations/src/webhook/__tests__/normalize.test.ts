import { describe, expect, it } from "vitest";
import { GenericWebhookPayloadSchema, normalizeGenericWebhook } from "../normalize";

describe("GenericWebhookPayloadSchema", () => {
  it("accepts a minimal payload, defaulting severity/priority/description/metadata", () => {
    const parsed = GenericWebhookPayloadSchema.parse({ externalId: "ext-1", title: "Disk full" });
    expect(parsed).toEqual({
      externalId: "ext-1",
      title: "Disk full",
      description: "",
      severity: "MEDIUM",
      priority: "P3",
      metadata: {},
    });
  });

  it("requires externalId and title", () => {
    expect(() => GenericWebhookPayloadSchema.parse({ title: "x" })).toThrow();
    expect(() => GenericWebhookPayloadSchema.parse({ externalId: "x" })).toThrow();
  });

  it("rejects an invalid severity/priority rather than silently coercing it", () => {
    expect(() =>
      GenericWebhookPayloadSchema.parse({ externalId: "x", title: "x", severity: "SUPER_BAD" }),
    ).toThrow();
  });

  it("accepts every optional field", () => {
    const parsed = GenericWebhookPayloadSchema.parse({
      externalId: "ext-2",
      title: "API latency spike",
      description: "p99 above 2s",
      severity: "CRITICAL",
      priority: "P1",
      service: "checkout-api",
      environment: "prod",
      resource: "checkout-api-7f9",
      metadata: { region: "us-east-1" },
    });
    expect(parsed.service).toBe("checkout-api");
    expect(parsed.metadata).toEqual({ region: "us-east-1" });
  });
});

describe("normalizeGenericWebhook", () => {
  it("maps directly onto NormalizedIncident's fields, always as source WEBHOOK and status NEW", () => {
    const payload = GenericWebhookPayloadSchema.parse({
      externalId: "ext-1",
      title: "Disk full",
      severity: "HIGH",
      priority: "P2",
      service: "billing",
    });
    expect(normalizeGenericWebhook(payload)).toEqual({
      externalId: "ext-1",
      source: "WEBHOOK",
      title: "Disk full",
      description: "",
      severity: "HIGH",
      priority: "P2",
      status: "NEW",
      service: "billing",
      environment: undefined,
      resource: undefined,
      metadata: {},
    });
  });
});
