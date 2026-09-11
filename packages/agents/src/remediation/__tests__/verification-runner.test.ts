import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { runVerification } from "../verification-runner";

const provider: MapServerProvider = {
  type: "FABRIC",
  metadata: { displayName: "Fabric (fixture)", isMock: false },
  configSchema: z.object({}),
  authAdapter: { authenticationTypes: ["SERVICE_PRINCIPAL"], testConnection: async () => ({ status: "CONNECTED" }) },
  capabilities: [
    {
      key: "retry_pipeline",
      description: "Retry a pipeline",
      riskLevel: "LOW",
      mutating: true,
      inputSchema: z.object({ pipelineId: z.string() }),
      outputSchema: z.object({ jobInstanceId: z.string() }),
      execute: async () => ({ jobInstanceId: "job1" }),
      verification: {
        capabilityKey: "get_pipeline_run",
        buildInput: (input: unknown, output: unknown) => ({
          pipelineId: (input as { pipelineId: string }).pipelineId,
          jobInstanceId: (output as { jobInstanceId: string }).jobInstanceId,
        }),
        classify: (out: unknown) => {
          const status = (out as { status: string }).status;
          if (status === "Completed") return "PASSED";
          if (status === "Failed") return "FAILED";
          return "RETRYING";
        },
      },
    },
    {
      key: "get_pipeline_run",
      description: "Get pipeline run status",
      riskLevel: "LOW",
      mutating: false,
      inputSchema: z.object({ pipelineId: z.string(), jobInstanceId: z.string() }),
      outputSchema: z.object({ status: z.string() }),
      execute: async (_ctx, rawInput: unknown) => {
        const input = rawInput as { jobInstanceId: string };
        return {
          status:
            input.jobInstanceId === "job-fail"
              ? "Failed"
              : input.jobInstanceId === "job-progress"
                ? "InProgress"
                : "Completed",
        };
      },
    },
    {
      key: "no_verification",
      description: "A mutating capability with no verification companion declared",
      riskLevel: "LOW",
      mutating: true,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    },
  ],
  healthCheck: async () => ({ status: "CONNECTED" }),
};

const contextFor = async () => ({
  organizationId: "org1",
  mapServerId: "ms1",
  environment: "default",
  credential: {},
  requestId: "req1",
});

describe("runVerification", () => {
  afterEach(() => __resetRegistryForTests());

  it("classifies PASSED when the companion capability reports success", async () => {
    registerMapServer(provider);
    const result = await runVerification({
      mapServerType: "FABRIC",
      mapServerId: "ms1",
      capabilityKey: "retry_pipeline",
      mutatingInput: { pipelineId: "p1" },
      mutatingOutput: { jobInstanceId: "job1" },
      contextFor,
    });
    expect(result?.status).toBe("PASSED");
    expect(result?.actualState).toEqual({ status: "Completed" });
  });

  it("classifies FAILED and RETRYING correctly", async () => {
    registerMapServer(provider);
    const failed = await runVerification({
      mapServerType: "FABRIC",
      mapServerId: "ms1",
      capabilityKey: "retry_pipeline",
      mutatingInput: { pipelineId: "p1" },
      mutatingOutput: { jobInstanceId: "job-fail" },
      contextFor,
    });
    expect(failed?.status).toBe("FAILED");

    const retrying = await runVerification({
      mapServerType: "FABRIC",
      mapServerId: "ms1",
      capabilityKey: "retry_pipeline",
      mutatingInput: { pipelineId: "p1" },
      mutatingOutput: { jobInstanceId: "job-progress" },
      contextFor,
    });
    expect(retrying?.status).toBe("RETRYING");
  });

  it("returns null when the capability declares no verification companion", async () => {
    registerMapServer(provider);
    const result = await runVerification({
      mapServerType: "FABRIC",
      mapServerId: "ms1",
      capabilityKey: "no_verification",
      mutatingInput: {},
      mutatingOutput: {},
      contextFor,
    });
    expect(result).toBeNull();
  });

  it("returns null when no provider is registered for the type", async () => {
    const result = await runVerification({
      mapServerType: "FABRIC",
      mapServerId: "ms1",
      capabilityKey: "retry_pipeline",
      mutatingInput: { pipelineId: "p1" },
      mutatingOutput: { jobInstanceId: "job1" },
      contextFor,
    });
    expect(result).toBeNull();
  });
});
