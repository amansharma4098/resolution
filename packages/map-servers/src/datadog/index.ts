import type { AnyCapability, MapServerProvider } from "../types";
import { DatadogConfigSchema } from "./config.schema";
import { datadogClientFromContext } from "./context";
import { getMonitorCapability } from "./capabilities/get-monitor";
import { listMonitorsCapability } from "./capabilities/list-monitors";
import { queryMetricsCapability } from "./capabilities/query-metrics";
import { searchLogsCapability } from "./capabilities/search-logs";
import { muteMonitorCapability } from "./capabilities/mute-monitor";
import { unmuteMonitorCapability } from "./capabilities/unmute-monitor";

export * from "./client";
export * from "./context";

/**
 * The second real Map Server provider (after Fabric) — see docs/map-server.md for the
 * seven-piece pattern this follows exactly. Real observability data (metrics, logs, monitor
 * state) as investigation evidence, plus one real mutating action (muting a noisy monitor)
 * for the remediation flow to use.
 */
export const datadogProvider: MapServerProvider = {
  type: "DATADOG",
  metadata: {
    displayName: "Datadog",
    docsUrl: "https://docs.datadoghq.com/api/latest/",
    isMock: false,
  },
  configSchema: DatadogConfigSchema,
  authAdapter: {
    authenticationTypes: ["CUSTOM"],
    testConnection: async (ctx) => {
      try {
        const client = datadogClientFromContext(ctx);
        const { valid } = await client.validate();
        return valid
          ? { status: "CONNECTED" }
          : { status: "DISCONNECTED", detail: "Datadog reported this API key pair as invalid" };
      } catch (err) {
        return { status: "DISCONNECTED", detail: err instanceof Error ? err.message : "Connection failed" };
      }
    },
  },
  capabilities: [
    getMonitorCapability,
    listMonitorsCapability,
    queryMetricsCapability,
    searchLogsCapability,
    muteMonitorCapability,
    unmuteMonitorCapability,
  ] as unknown as AnyCapability[],
  healthCheck: async (ctx) => {
    try {
      const client = datadogClientFromContext(ctx);
      const monitors = await client.listMonitors();
      return { status: "CONNECTED", detail: `${monitors.length} monitor(s) visible to this key pair` };
    } catch (err) {
      return { status: "DISCONNECTED", detail: err instanceof Error ? err.message : "Connection failed" };
    }
  },
};
