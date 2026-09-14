/**
 * A thin wrapper over the real Datadog REST API — no SDK, just typed fetch calls, same
 * reasoning as every other Map Server client in this package (Workers-native, no
 * Node-only dependency). Follows Datadog's published v1/v2 API docs
 * (https://docs.datadoghq.com/api/latest/) — not exercised against a live Datadog account
 * in this environment (no test account was available), flagged the same way Fabric's
 * client.ts is for the same reason.
 */
export interface DatadogMonitor {
  id: number;
  name: string;
  message: string;
  query: string;
  overall_state: string; // "Alert" | "Warn" | "No Data" | "OK" | "Ignored" | "Skipped"
  tags: string[];
  options: { silenced?: Record<string, number | null> };
}

export interface DatadogMetricSeries {
  metric: string;
  scope: string;
  pointlist: [number, number][]; // [timestampMs, value]
}

export interface DatadogLogEvent {
  id: string;
  timestamp: string;
  message: string;
  status: string;
  service: string | null;
  host: string | null;
}

export class DatadogApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DatadogApiError";
  }
}

export interface DatadogCredential {
  apiKey: string;
  applicationKey: string;
}

export class DatadogClient {
  constructor(
    private readonly site: string,
    private readonly credential: DatadogCredential,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`https://api.${this.site}${path}`, {
      ...init,
      headers: {
        "DD-API-KEY": this.credential.apiKey,
        "DD-APPLICATION-KEY": this.credential.applicationKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new DatadogApiError(`Datadog API ${path} returned ${res.status}: ${body.slice(0, 500)}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Real, cheap, config-independent — used as both the auth adapter's testConnection and
   *  the health check (ARCHITECTURE.md §4's MapServerContext carries no org-configured
   *  "target" the way a workspaceId would, so a connectivity check can't target anything
   *  more specific than "is this key pair valid"). */
  async validate(): Promise<{ valid: boolean }> {
    return this.request("/api/v1/validate");
  }

  async queryMetrics(query: string, fromUnixSeconds: number, toUnixSeconds: number): Promise<{ series: DatadogMetricSeries[] }> {
    const params = new URLSearchParams({ query, from: String(fromUnixSeconds), to: String(toUnixSeconds) });
    return this.request(`/api/v1/query?${params.toString()}`);
  }

  async searchLogs(query: string, from: string, to: string, limit: number): Promise<{ data: DatadogLogEvent[] }> {
    const body = await this.request<{
      data: Array<{ id: string; attributes: { timestamp: string; message: string; status: string; service?: string; host?: string } }>;
    }>("/api/v2/logs/events/search", {
      method: "POST",
      body: JSON.stringify({ filter: { query, from, to }, page: { limit } }),
    });
    return {
      data: body.data.map((event) => ({
        id: event.id,
        timestamp: event.attributes.timestamp,
        message: event.attributes.message,
        status: event.attributes.status,
        service: event.attributes.service ?? null,
        host: event.attributes.host ?? null,
      })),
    };
  }

  async getMonitor(monitorId: number): Promise<DatadogMonitor> {
    return this.request(`/api/v1/monitor/${monitorId}`);
  }

  async listMonitors(tags?: string): Promise<DatadogMonitor[]> {
    const params = tags ? `?${new URLSearchParams({ monitor_tags: tags }).toString()}` : "";
    return this.request(`/api/v1/monitor${params}`);
  }

  /** `endUnixSeconds: null` (or omitted) mutes indefinitely, matching Datadog's own API —
   *  the caller decides whether that's appropriate; this client doesn't second-guess it. */
  async muteMonitor(monitorId: number, endUnixSeconds?: number | null): Promise<DatadogMonitor> {
    return this.request(`/api/v1/monitor/${monitorId}/mute`, {
      method: "POST",
      body: JSON.stringify(endUnixSeconds ? { end: endUnixSeconds } : {}),
    });
  }

  async unmuteMonitor(monitorId: number): Promise<DatadogMonitor> {
    return this.request(`/api/v1/monitor/${monitorId}/unmute`, { method: "POST" });
  }
}
