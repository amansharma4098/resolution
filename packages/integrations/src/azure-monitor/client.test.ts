import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureMonitorClient } from "./client";
import { azureAlertPayload, normalizeAzureMonitor } from "./normalize";
const subscription = "11111111-1111-1111-1111-111111111111";
const credential = { tenantId: subscription, clientId: subscription, clientSecret: "secret" };
const id = `/subscriptions/${subscription}/providers/Microsoft.AlertsManagement/alerts/22222222-2222-2222-2222-222222222222`;
const alert = {
  id,
  name: "CPU",
  properties: {
    essentials: {
      severity: "Sev1",
      monitorCondition: "Fired",
      alertState: "New",
      alertRule: "CPU high",
    },
  },
};
const json = (value: unknown) => new Response(JSON.stringify(value));
describe("Azure Monitor", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("normalizes active alerts and ignores recovered alerts", () => {
    expect(normalizeAzureMonitor(azureAlertPayload(alert))).toMatchObject({
      source: "AZURE_MONITOR",
      severity: "HIGH",
      externalId: id,
      affectedSystem: "AZURE",
    });
    expect(
      normalizeAzureMonitor(
        azureAlertPayload({
          ...alert,
          properties: {
            essentials: { ...alert.properties.essentials, monitorCondition: "Resolved" },
          },
        }),
      ),
    ).toBeNull();
  });
  it("gets a service principal token and lists alerts with bounded, redirect-free requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "access-token" }))
      .mockResolvedValueOnce(json({ value: [alert] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await new AzureMonitorClient(subscription, credential).listAlerts()).value,
    ).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://login.microsoftonline.com/${subscription}/oauth2/v2.0/token`,
    );
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer access-token" },
    });
  });
  it("rejects foreign pagination endpoints before sending credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new AzureMonitorClient(subscription, credential).listAlerts(
        `https://evil.example/subscriptions/${subscription}/providers/Microsoft.AlertsManagement/alerts`,
      ),
    ).rejects.toThrow("endpoint");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cannot close an alert whose underlying condition is still fired", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "token" }))
      .mockResolvedValueOnce(json(alert));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new AzureMonitorClient(subscription, credential).closeAlert(id, "Recovered"),
    ).rejects.toThrow("still reports");
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1); // Token only.
  });
});
