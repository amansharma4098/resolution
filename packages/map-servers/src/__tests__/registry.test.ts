import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetRegistryForTests,
  getMapServerCatalog,
  getMapServerProvider,
  isMapServerTypeAvailable,
  registerMapServer,
} from "../registry";
import type { MapServerProvider } from "../types";

const fixtureProvider: MapServerProvider = {
  type: "DATABRICKS",
  metadata: { displayName: "Databricks (fixture)", isMock: true },
  configSchema: z.object({ workspaceUrl: z.string() }),
  authAdapter: {
    authenticationTypes: ["SERVICE_PRINCIPAL"],
    testConnection: async () => ({ status: "CONNECTED" }),
  },
  capabilities: [
    {
      key: "get_job_run",
      description: "Fetch a job run",
      riskLevel: "LOW",
      mutating: false,
      inputSchema: z.object({ runId: z.string() }),
      outputSchema: z.object({ status: z.string() }),
      execute: async () => ({ status: "SUCCESS" }),
    },
  ],
  healthCheck: async () => ({ status: "CONNECTED" }),
};

describe("map server registry", () => {
  afterEach(() => {
    __resetRegistryForTests();
  });

  it("starts with no providers available for any type", () => {
    expect(isMapServerTypeAvailable("FABRIC")).toBe(false);
    expect(getMapServerProvider("FABRIC")).toBeUndefined();
  });

  it("registers a provider and makes it retrievable", () => {
    registerMapServer(fixtureProvider);
    expect(isMapServerTypeAvailable("DATABRICKS")).toBe(true);
    expect(getMapServerProvider("DATABRICKS")).toBe(fixtureProvider);
  });

  it("refuses to register two providers for the same type", () => {
    registerMapServer(fixtureProvider);
    expect(() => registerMapServer(fixtureProvider)).toThrow(/already registered/);
  });

  it("the catalog lists every MapServerType, most unavailable until registered", () => {
    const catalog = getMapServerCatalog();
    const types = catalog.map((e) => e.type);
    expect(types).toContain("FABRIC");
    expect(types).toContain("DATABRICKS");
    expect(types).toContain("AWS");

    const fabric = catalog.find((e) => e.type === "FABRIC")!;
    expect(fabric.available).toBe(false);
    expect(fabric.capabilityCount).toBe(0);
  });

  it("the catalog reflects a registered provider's metadata and capability count", () => {
    registerMapServer(fixtureProvider);
    const entry = getMapServerCatalog().find((e) => e.type === "DATABRICKS")!;
    expect(entry.available).toBe(true);
    expect(entry.isMock).toBe(true);
    expect(entry.displayName).toBe("Databricks (fixture)");
    expect(entry.capabilityCount).toBe(1);
  });
});
