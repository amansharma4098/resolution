import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { LlmClient, LlmTurnResult } from "@resolution/ai";
import type { AnyCapability } from "@resolution/map-servers";
import type { AvailableCapability } from "../../investigation/tool-catalog";
import { ResolutionIncompleteError, runResolutionAgent } from "../resolution-agent";

function scriptedLlmClient(turns: LlmTurnResult[]): LlmClient {
  let call = 0;
  return {
    isMock: true,
    async send() {
      const turn = turns[call];
      call += 1;
      if (!turn) throw new Error(`scriptedLlmClient: no scripted turn for call #${call}`);
      return turn;
    },
  };
}

function toolUseTurn(blocks: { name: string; input: unknown }[]): LlmTurnResult {
  const toolUses: Anthropic.ToolUseBlock[] = blocks.map((b, i) => ({
    type: "tool_use",
    id: `t_${i}_${Math.random()}`,
    name: b.name,
    input: b.input,
    caller: { type: "direct" },
  }));
  return { stopReason: "tool_use", content: toolUses, toolUses };
}

function textOnlyTurn(text: string): LlmTurnResult {
  const block: Anthropic.TextBlock = { type: "text", text, citations: [] };
  return { stopReason: "end_turn", content: [block], toolUses: [] };
}

function fakeCapability(overrides: Partial<AnyCapability> = {}): AnyCapability {
  return {
    key: "retry_pipeline",
    description: "Retry a failed pipeline",
    riskLevel: "LOW",
    mutating: true,
    inputSchema: z.object({ pipelineId: z.string().min(1) }),
    outputSchema: z.object({ jobInstanceId: z.string().nullable() }),
    execute: async () => ({ jobInstanceId: "job1" }),
    ...overrides,
  } as AnyCapability;
}

const incident = {
  title: "Nightly pipeline failing",
  description: "Timeout after 30 minutes",
  severity: "HIGH",
  priority: "P2",
  source: "SERVICENOW",
};

const rca = {
  summary: "Pipeline stalled due to a transient upstream timeout",
  claims: [{ text: "Pipeline job timed out", claimType: "INFERENCE" as const, evidenceIds: [], confidence: 0.6 }],
  confidence: 0.6,
  alternativeHypotheses: [],
};

describe("runResolutionAgent", () => {
  it("returns no_action immediately when there are no mutating capabilities available", async () => {
    const llmClient = scriptedLlmClient([]);
    const result = await runResolutionAgent(incident, rca, { llmClient, availableCapabilities: [] });
    expect(result).toEqual({ kind: "no_action", reason: "No mutating capabilities are enabled for this organization" });
  });

  it("proposes exactly one remediation when the model calls a capability tool", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const llmClient = scriptedLlmClient([toolUseTurn([{ name: "ms1__retry_pipeline", input: { pipelineId: "p1" } }])]);

    const result = await runResolutionAgent(incident, rca, { llmClient, availableCapabilities: available });
    expect(result.kind).toBe("proposed");
    if (result.kind === "proposed") {
      expect(result.proposal.mapServerId).toBe("ms1");
      expect(result.proposal.capability.key).toBe("retry_pipeline");
      expect(result.proposal.input).toEqual({ pipelineId: "p1" });
    }
  });

  it("honors an explicit no_remediation_needed call with its reason", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const llmClient = scriptedLlmClient([
      toolUseTurn([{ name: "no_remediation_needed", input: { reason: "Root cause is unconfirmed" } }]),
    ]);

    const result = await runResolutionAgent(incident, rca, { llmClient, availableCapabilities: available });
    expect(result).toEqual({ kind: "no_action", reason: "Root cause is unconfirmed" });
  });

  it("rejects invalid tool input server-side and lets the model retry", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const llmClient = scriptedLlmClient([
      toolUseTurn([{ name: "ms1__retry_pipeline", input: { pipelineId: "" } }]), // fails min(1)
      toolUseTurn([{ name: "ms1__retry_pipeline", input: { pipelineId: "p1" } }]),
    ]);

    const result = await runResolutionAgent(incident, rca, { llmClient, availableCapabilities: available });
    expect(result.kind).toBe("proposed");
  });

  it("only accepts the first tool call in a turn with multiple, and still answers every tool_use", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const llmClient = scriptedLlmClient([
      toolUseTurn([
        { name: "ms1__retry_pipeline", input: { pipelineId: "p1" } },
        { name: "ms1__retry_pipeline", input: { pipelineId: "p2" } },
      ]),
    ]);

    const result = await runResolutionAgent(incident, rca, { llmClient, availableCapabilities: available });
    expect(result.kind).toBe("proposed");
    if (result.kind === "proposed") {
      expect(result.proposal.input).toEqual({ pipelineId: "p1" });
    }
  });

  it("throws ResolutionIncompleteError after exhausting maxIterations without a decision", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const llmClient = scriptedLlmClient([textOnlyTurn("thinking"), textOnlyTurn("thinking")]);

    await expect(
      runResolutionAgent(incident, rca, { llmClient, availableCapabilities: available, maxIterations: 2 }),
    ).rejects.toThrow(ResolutionIncompleteError);
  });

  it("throws ResolutionIncompleteError on a refusal", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const llmClient = scriptedLlmClient([{ stopReason: "refusal", content: [], toolUses: [] }]);

    await expect(
      runResolutionAgent(incident, rca, { llmClient, availableCapabilities: available }),
    ).rejects.toThrow(ResolutionIncompleteError);
  });
});
