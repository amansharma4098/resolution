import { afterEach, describe, expect, it, vi } from "vitest";
import { fabricProvider } from "../index";
import type { MapServerContext } from "../../types";

const context: MapServerContext = {
  organizationId: "org1",
  mapServerId: "ms1",
  environment: "prod",
  credential: { tenantId: "t1", clientId: "c1", clientSecret: "s1" },
  requestId: "req1",
};

function mockTokenThenApi(apiResponse: Response) {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }));
  fetchMock.mockResolvedValueOnce(apiResponse);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fabricProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declares the exact five capabilities from ARCHITECTURE.md §4", () => {
    const keys = fabricProvider.capabilities.map((c) => c.key).sort();
    expect(keys).toEqual([
      "get_logs",
      "get_pipeline",
      "get_pipeline_run",
      "get_workspace",
      "retry_pipeline",
    ]);
  });

  it("only retry_pipeline is mutating", () => {
    for (const cap of fabricProvider.capabilities) {
      expect(cap.mutating).toBe(cap.key === "retry_pipeline");
    }
  });

  it("declares SERVICE_PRINCIPAL as its authentication type", () => {
    expect(fabricProvider.authAdapter.authenticationTypes).toEqual(["SERVICE_PRINCIPAL"]);
  });

  it("is not a mock provider", () => {
    expect(fabricProvider.metadata.isMock).toBe(false);
  });

  it("healthCheck reports CONNECTED on a successful workspace listing", async () => {
    mockTokenThenApi(new Response(JSON.stringify({ value: [{ id: "ws1", displayName: "A", type: "Workspace" }] }), { status: 200 }));
    const result = await fabricProvider.healthCheck(context);
    expect(result.status).toBe("CONNECTED");
    expect(result.detail).toContain("1 workspace");
  });

  it("healthCheck reports DISCONNECTED with a real reason on auth failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("invalid_client", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fabricProvider.healthCheck(context);
    expect(result.status).toBe("DISCONNECTED");
    expect(result.detail).toBeTruthy();
  });

  it("healthCheck reports DISCONNECTED when the credential is missing required fields", async () => {
    const badContext: MapServerContext = { ...context, credential: {} };
    const result = await fabricProvider.healthCheck(badContext);
    expect(result.status).toBe("DISCONNECTED");
    expect(result.detail).toMatch(/SERVICE_PRINCIPAL credential/);
  });

  it("get_workspace capability executes and validates its output schema", async () => {
    mockTokenThenApi(
      new Response(JSON.stringify({ id: "ws1", displayName: "Analytics", type: "Workspace" }), { status: 200 }),
    );
    const cap = fabricProvider.capabilities.find((c) => c.key === "get_workspace")!;
    const input = cap.inputSchema.parse({ workspaceId: "ws1" });
    const output = await cap.execute(context, input);
    expect(() => cap.outputSchema.parse(output)).not.toThrow();
    expect(output).toMatchObject({ id: "ws1", displayName: "Analytics" });
  });

  it("retry_pipeline capability rejects an input missing pipelineId", () => {
    const cap = fabricProvider.capabilities.find((c) => c.key === "retry_pipeline")!;
    expect(() => cap.inputSchema.parse({ workspaceId: "ws1" })).toThrow();
  });
});
