import { z } from "zod";
import type { AnyCapability, MapServerProvider } from "../types";
import { fabricClientFromContext } from "./context";
import { getWorkspaceCapability } from "./capabilities/get-workspace";
import { getPipelineCapability } from "./capabilities/get-pipeline";
import { getPipelineRunCapability } from "./capabilities/get-pipeline-run";
import { getLogsCapability } from "./capabilities/get-logs";
import { retryPipelineCapability } from "./capabilities/retry-pipeline";

export * from "./client";
export * from "./context";

/**
 * The first real Map Server provider — see docs/map-server.md for the seven-piece pattern
 * this follows exactly, and packages/map-servers/src/registry.ts for how it's registered
 * (only by apps/api/src/worker.ts at boot, never as a side effect of importing this
 * package, so tests that expect an empty registry stay unaffected).
 */
export const fabricProvider: MapServerProvider = {
  type: "FABRIC",
  metadata: {
    displayName: "Microsoft Fabric",
    docsUrl: "https://learn.microsoft.com/en-us/rest/api/fabric/",
    isMock: false,
  },
  configSchema: z.object({
    workspaceId: z.string().min(1, "workspaceId is required"),
  }),
  authAdapter: {
    authenticationTypes: ["SERVICE_PRINCIPAL"],
    testConnection: async (ctx) => {
      try {
        const client = await fabricClientFromContext(ctx);
        await client.listWorkspaces();
        return { status: "CONNECTED" };
      } catch (err) {
        return { status: "DISCONNECTED", detail: err instanceof Error ? err.message : "Connection failed" };
      }
    },
  },
  // Each capability keeps its own strongly-typed input/output at its definition site
  // (packages/map-servers/src/fabric/capabilities/*.ts) — this cast to the registry's
  // common `AnyCapability` shape is the standard, sound escape from TypeScript's
  // contravariant function-parameter checking for a heterogeneous array of otherwise
  // differently-typed `execute` functions. It's safe in practice because a capability is
  // only ever invoked with input already validated against *that same capability's own*
  // inputSchema (packages/map-servers/src/registry.ts / docs/map-server.md) — schemas are
  // never cross-wired between capabilities.
  capabilities: [
    getWorkspaceCapability,
    getPipelineCapability,
    getPipelineRunCapability,
    getLogsCapability,
    retryPipelineCapability,
  ] as unknown as AnyCapability[],
  healthCheck: async (ctx) => {
    try {
      const client = await fabricClientFromContext(ctx);
      const { value } = await client.listWorkspaces();
      return { status: "CONNECTED", detail: `${value.length} workspace(s) visible to this service principal` };
    } catch (err) {
      return { status: "DISCONNECTED", detail: err instanceof Error ? err.message : "Connection failed" };
    }
  },
};
