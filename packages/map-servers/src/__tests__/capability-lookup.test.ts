import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveCapability } from "../capability-lookup";
import type { MapServerContext, MapServerProvider } from "../types";

const ctx: MapServerContext = {
  organizationId: "org1",
  mapServerId: "ms1",
  environment: "default",
  credential: {},
  config: {},
  requestId: "req1",
};

const staticCapability = {
  key: "static_one",
  description: "d",
  riskLevel: "LOW" as const,
  mutating: false,
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
};

function staticProvider(): MapServerProvider {
  return {
    type: "FABRIC",
    metadata: { displayName: "Static", isMock: false },
    configSchema: z.object({}),
    authAdapter: { authenticationTypes: ["TOKEN"], testConnection: async () => ({ status: "CONNECTED" }) },
    capabilities: [staticCapability],
    healthCheck: async () => ({ status: "CONNECTED" }),
  };
}

function dynamicProvider(): MapServerProvider {
  return {
    ...staticProvider(),
    capabilities: [],
    discoverCapabilities: async () => [
      { ...staticCapability, key: "discovered_one" },
    ],
  };
}

describe("resolveCapability", () => {
  it("finds a capability in the static array without calling discoverCapabilities", async () => {
    const found = await resolveCapability(staticProvider(), ctx, "static_one");
    expect(found?.key).toBe("static_one");
  });

  it("returns undefined for an unknown key on a provider with no discoverCapabilities", async () => {
    const found = await resolveCapability(staticProvider(), ctx, "nope");
    expect(found).toBeUndefined();
  });

  it("falls back to discoverCapabilities when the static array doesn't have the key", async () => {
    const found = await resolveCapability(dynamicProvider(), ctx, "discovered_one");
    expect(found?.key).toBe("discovered_one");
  });

  it("returns undefined when even the discovered set doesn't have the key", async () => {
    const found = await resolveCapability(dynamicProvider(), ctx, "nope");
    expect(found).toBeUndefined();
  });

  it("checks the static array first even on a provider that also declares discoverCapabilities", async () => {
    const provider: MapServerProvider = {
      ...dynamicProvider(),
      capabilities: [staticCapability],
    };
    const found = await resolveCapability(provider, ctx, "static_one");
    expect(found?.key).toBe("static_one");
  });
});
