import { afterEach, describe, expect, it, vi } from "vitest";
import { datadogProvider } from "../index";
import type { MapServerContext } from "../../types";

const context: MapServerContext = {
  tenantId: "org1",
  mapServerId: "ms1",
  environment: "prod",
  credential: { apiKey: "k1", applicationKey: "a1" },
  config: {},
  requestId: "req1",
};

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("datadogProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declares the exact six capabilities", () => {
    const keys = datadogProvider.capabilities.map((c) => c.key).sort();
    expect(keys).toEqual([
      "get_monitor",
      "list_monitors",
      "mute_monitor",
      "query_metrics",
      "search_logs",
      "unmute_monitor",
    ]);
  });

  it("only mute_monitor and unmute_monitor are mutating", () => {
    for (const cap of datadogProvider.capabilities) {
      expect(cap.mutating).toBe(cap.key === "mute_monitor" || cap.key === "unmute_monitor");
    }
  });

  it("mute_monitor is MEDIUM risk, unmute_monitor is LOW", () => {
    const mute = datadogProvider.capabilities.find((c) => c.key === "mute_monitor")!;
    const unmute = datadogProvider.capabilities.find((c) => c.key === "unmute_monitor")!;
    expect(mute.riskLevel).toBe("MEDIUM");
    expect(unmute.riskLevel).toBe("LOW");
  });

  it("declares CUSTOM as its authentication type", () => {
    expect(datadogProvider.authAdapter.authenticationTypes).toEqual(["CUSTOM"]);
  });

  it("is not a mock provider", () => {
    expect(datadogProvider.metadata.isMock).toBe(false);
  });

  it("healthCheck reports CONNECTED with a monitor count on success", async () => {
    stubFetch(
      new Response(JSON.stringify([{ id: 1, name: "x", message: "", query: "", overall_state: "OK", tags: [], options: {} }]), {
        status: 200,
      }),
    );
    const result = await datadogProvider.healthCheck(context);
    expect(result.status).toBe("CONNECTED");
    expect(result.detail).toContain("1 monitor(s)");
  });

  it("healthCheck reports DISCONNECTED with a real reason on auth failure", async () => {
    stubFetch(new Response("Forbidden", { status: 403 }));
    const result = await datadogProvider.healthCheck(context);
    expect(result.status).toBe("DISCONNECTED");
    expect(result.detail).toBeTruthy();
  });

  it("healthCheck reports DISCONNECTED when the credential is missing required fields", async () => {
    const badContext: MapServerContext = { ...context, credential: {} };
    const result = await datadogProvider.healthCheck(badContext);
    expect(result.status).toBe("DISCONNECTED");
    expect(result.detail).toMatch(/CUSTOM credential/);
  });

  it("testConnection reports DISCONNECTED when Datadog reports the key pair invalid (200 but valid:false)", async () => {
    stubFetch(new Response(JSON.stringify({ valid: false }), { status: 200 }));
    const result = await datadogProvider.authAdapter.testConnection(context);
    expect(result.status).toBe("DISCONNECTED");
  });

  it("get_monitor capability executes and validates its output schema, flattening silenced state", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ id: 42, name: "High CPU", message: "m", query: "q", overall_state: "Alert", tags: ["env:prod"], options: { silenced: { "*": null } } }),
        { status: 200 },
      ),
    );
    const cap = datadogProvider.capabilities.find((c) => c.key === "get_monitor")!;
    const input = cap.inputSchema.parse({ monitorId: 42 });
    const output = await cap.execute(context, input);
    expect(() => cap.outputSchema.parse(output)).not.toThrow();
    expect(output).toMatchObject({ id: 42, overallState: "Alert", silenced: true });
  });

  it("mute_monitor capability rejects an input missing monitorId", () => {
    const cap = datadogProvider.capabilities.find((c) => c.key === "mute_monitor")!;
    expect(() => cap.inputSchema.parse({})).toThrow();
  });

  it("mute_monitor's verification spec classifies PASSED only when the re-read monitor is actually silenced", () => {
    const cap = datadogProvider.capabilities.find((c) => c.key === "mute_monitor")!;
    expect(cap.verification!.classify({ silenced: true })).toBe("PASSED");
    expect(cap.verification!.classify({ silenced: false })).toBe("FAILED");
  });
});
