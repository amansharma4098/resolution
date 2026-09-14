import { describe, expect, it } from "vitest";
import { normalizeDatadogWebhook, type DatadogWebhookPayload } from "../normalize";

function payload(overrides: Partial<DatadogWebhookPayload> = {}): DatadogWebhookPayload {
  return {
    alert_id: "12345",
    alert_transition: "Triggered",
    alert_title: "[Triggered] High CPU on checkout-api",
    alert_query: "avg(last_5m):avg:system.cpu.user{service:checkout} > 90",
    event_msg: "CPU has been above 90% for 5 minutes",
    priority: "P2",
    host: "checkout-api-7f9",
    tags: "env:prod,service:checkout,team:payments",
    link: "https://app.datadoghq.com/monitors/999",
    ...overrides,
  };
}

describe("normalizeDatadogWebhook", () => {
  it("maps a Triggered alert into a normalized incident", () => {
    const result = normalizeDatadogWebhook(payload());
    expect(result).toMatchObject({
      externalId: "12345",
      source: "DATADOG",
      title: "[Triggered] High CPU on checkout-api",
      description: "CPU has been above 90% for 5 minutes",
      severity: "HIGH",
      priority: "P2",
      status: "NEW",
      service: "checkout",
      environment: "prod",
      resource: "checkout-api-7f9",
    });
    expect(result!.metadata).toMatchObject({ datadogAlertId: "12345", datadogAlertTransition: "Triggered" });
  });

  it("also handles a Re-Triggered transition", () => {
    expect(normalizeDatadogWebhook(payload({ alert_transition: "Re-Triggered" }))).not.toBeNull();
  });

  it("ignores Recovered/Warn/No Data transitions — same alert_id, no new incident", () => {
    expect(normalizeDatadogWebhook(payload({ alert_transition: "Recovered" }))).toBeNull();
    expect(normalizeDatadogWebhook(payload({ alert_transition: "Warn" }))).toBeNull();
    expect(normalizeDatadogWebhook(payload({ alert_transition: "No Data" }))).toBeNull();
  });

  it("maps every Datadog priority to a severity/priority pair, P5 folding into Resolution's P4 ceiling", () => {
    expect(normalizeDatadogWebhook(payload({ priority: "P1" }))).toMatchObject({ severity: "CRITICAL", priority: "P1" });
    expect(normalizeDatadogWebhook(payload({ priority: "P3" }))).toMatchObject({ severity: "MEDIUM", priority: "P3" });
    expect(normalizeDatadogWebhook(payload({ priority: "P4" }))).toMatchObject({ severity: "LOW", priority: "P4" });
    expect(normalizeDatadogWebhook(payload({ priority: "P5" }))).toMatchObject({ severity: "LOW", priority: "P4" });
  });

  it("falls back to MEDIUM/P3 for a missing or unrecognized priority — never invents signal", () => {
    expect(normalizeDatadogWebhook(payload({ priority: "" }))).toMatchObject({ severity: "MEDIUM", priority: "P3" });
    expect(normalizeDatadogWebhook(payload({ priority: undefined }))).toMatchObject({ severity: "MEDIUM", priority: "P3" });
  });

  it("extracts service/env from the tags string, tolerating tags without either", () => {
    const result = normalizeDatadogWebhook(payload({ tags: "team:payments" }));
    expect(result!.service).toBeUndefined();
    expect(result!.environment).toBeUndefined();
  });

  it("falls back the description to the alert query when there's no event message", () => {
    const result = normalizeDatadogWebhook(payload({ event_msg: undefined }));
    expect(result!.description).toBe(payload().alert_query);
  });
});
