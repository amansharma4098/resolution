import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatadogApiError, DatadogClient } from "../client";

describe("DatadogClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sends both Datadog auth headers and hits the correct site", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ valid: true }), { status: 200 }));
    const client = new DatadogClient("datadoghq.eu", { apiKey: "k1", applicationKey: "a1" });
    await client.validate();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.datadoghq.eu/api/v1/validate");
    const headers = init.headers as Record<string, string>;
    expect(headers["DD-API-KEY"]).toBe("k1");
    expect(headers["DD-APPLICATION-KEY"]).toBe("a1");
  });

  it("throws DatadogApiError with the status code on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    await expect(client.validate()).rejects.toMatchObject({ status: 403 });
    await expect(client.validate()).rejects.toBeInstanceOf(DatadogApiError);
  });

  it("queryMetrics passes query/from/to as query-string params", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ series: [] }), { status: 200 }));
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    await client.queryMetrics("avg:system.cpu.user{*}", 1000, 2000);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/v1/query?");
    expect(url).toContain("query=avg%3Asystem.cpu.user%7B*%7D");
    expect(url).toContain("from=1000");
    expect(url).toContain("to=2000");
  });

  it("searchLogs posts filter/page and flattens attributes into a plain event shape", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "ev1",
              attributes: { timestamp: "2026-01-01T00:00:00Z", message: "OOM killed", status: "error", service: "api", host: "web-1" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    const result = await client.searchLogs("status:error", "now-15m", "now", 50);

    expect(result.data).toEqual([
      { id: "ev1", timestamp: "2026-01-01T00:00:00Z", message: "OOM killed", status: "error", service: "api", host: "web-1" },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.datadoghq.com/api/v2/logs/events/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ filter: { query: "status:error", from: "now-15m", to: "now" }, page: { limit: 50 } });
  });

  it("getMonitor fetches by id", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: 42, name: "High CPU", message: "cpu high", query: "avg(last_5m)", overall_state: "Alert", tags: [], options: {} }),
        { status: 200 },
      ),
    );
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    const monitor = await client.getMonitor(42);
    expect(monitor.overall_state).toBe("Alert");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.datadoghq.com/api/v1/monitor/42");
  });

  it("listMonitors includes a tag filter when given", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    await client.listMonitors("service:checkout");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.datadoghq.com/api/v1/monitor?monitor_tags=service%3Acheckout");
  });

  it("muteMonitor posts an end timestamp when given, and an empty body when muting indefinitely", async () => {
    // A fresh Response per call — reusing one mockResolvedValue instance across two calls
    // would try to re-read an already-consumed body on the second .json().
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ id: 42, name: "x", message: "x", query: "x", overall_state: "OK", tags: [], options: { silenced: { "*": 9999 } } }),
          { status: 200 },
        ),
    );
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    await client.muteMonitor(42, 9999);
    let [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.datadoghq.com/api/v1/monitor/42/mute");
    expect(JSON.parse(init.body as string)).toEqual({ end: 9999 });

    await client.muteMonitor(42);
    [url, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("unmuteMonitor posts to the unmute endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 42, name: "x", message: "x", query: "x", overall_state: "OK", tags: [], options: {} }), { status: 200 }),
    );
    const client = new DatadogClient("datadoghq.com", { apiKey: "k1", applicationKey: "a1" });
    await client.unmuteMonitor(42);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.datadoghq.com/api/v1/monitor/42/unmute");
    expect(init.method).toBe("POST");
  });
});
