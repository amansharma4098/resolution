import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { LlmClient, LlmTurnResult } from "@resolution/ai";
import type { AnyCapability, MapServerContext } from "@resolution/map-servers";
import {
  InvestigationIncompleteError,
  runInvestigationAgent,
  type AvailableCapability,
} from "../investigation-agent";

const VALID_EVIDENCE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

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

function toolUseTurn(name: string, input: unknown): LlmTurnResult {
  const block: Anthropic.ToolUseBlock = {
    type: "tool_use",
    id: `t_${name}_${Math.random()}`,
    name,
    input,
    caller: { type: "direct" },
  };
  return { stopReason: "tool_use", content: [block], toolUses: [block] };
}

function textOnlyTurn(text: string): LlmTurnResult {
  const block: Anthropic.TextBlock = { type: "text", text, citations: [] };
  return { stopReason: "end_turn", content: [block], toolUses: [] };
}

function fakeCapability(overrides: Partial<AnyCapability> = {}): AnyCapability {
  return {
    key: "get_workspace",
    description: "Fetch a workspace",
    riskLevel: "LOW",
    mutating: false,
    inputSchema: z.object({ workspaceId: z.string().min(1) }),
    outputSchema: z.object({ id: z.string() }),
    execute: async (_ctx, input) => ({ id: (input as { workspaceId: string }).workspaceId }),
    ...overrides,
  } as AnyCapability;
}

const incident = {
  title: "VPN gateway unreachable",
  description: "Site-to-site tunnel dropped",
  severity: "CRITICAL",
  priority: "P1",
  source: "SERVICENOW",
};

function baseDeps(llmClient: LlmClient, available: AvailableCapability[] = []) {
  return {
    llmClient,
    availableCapabilities: available,
    contextFor: async (): Promise<MapServerContext> => ({
      organizationId: "org1",
      mapServerId: "ms1",
      environment: "default",
      credential: {},
      requestId: "req1",
    }),
    recordEvidence: async () => VALID_EVIDENCE_ID,
  };
}

describe("runInvestigationAgent", () => {
  it("calls a capability, then submits an RCA citing the returned evidenceId", async () => {
    const capability = fakeCapability();
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];
    const toolName = `ms1__get_workspace`;

    const llmClient = scriptedLlmClient([
      toolUseTurn(toolName, { workspaceId: "ws1" }),
      toolUseTurn("submit_rca", {
        summary: "Root cause found",
        claims: [
          { text: "Workspace ws1 is misconfigured", claimType: "FACT", evidenceIds: [VALID_EVIDENCE_ID], confidence: 0.8 },
        ],
        confidence: 0.8,
        alternativeHypotheses: [],
      }),
    ]);

    const result = await runInvestigationAgent(incident, baseDeps(llmClient, available));

    expect(result.toolCallCount).toBe(1);
    expect(result.rca.summary).toBe("Root cause found");
    expect(result.rca.claims[0]!.evidenceIds).toContain(VALID_EVIDENCE_ID);
  });

  it("rejects an invalid submit_rca call server-side and lets the model retry", async () => {
    const llmClient = scriptedLlmClient([
      // A FACT claim with no evidenceId violates rca.ts's .refine() — must be rejected even
      // though it matches the tool's JSON schema shape (schema alone can't express the rule).
      toolUseTurn("submit_rca", {
        summary: "Unsupported claim",
        claims: [{ text: "It's definitely the network", claimType: "FACT", evidenceIds: [], confidence: 0.9 }],
        confidence: 0.9,
        alternativeHypotheses: [],
      }),
      toolUseTurn("submit_rca", {
        summary: "Corrected",
        claims: [{ text: "Likely a network issue", claimType: "HYPOTHESIS", evidenceIds: [], confidence: 0.4 }],
        confidence: 0.4,
        alternativeHypotheses: [],
      }),
    ]);

    const result = await runInvestigationAgent(incident, baseDeps(llmClient, []));
    expect(result.rca.summary).toBe("Corrected");
  });

  it("records a tool execution failure as an error tool_result and keeps going", async () => {
    const capability = fakeCapability({
      execute: async () => {
        throw new Error("upstream 500");
      },
    });
    const available: AvailableCapability[] = [{ mapServerId: "ms1", mapServerType: "FABRIC", capability }];

    const llmClient = scriptedLlmClient([
      toolUseTurn("ms1__get_workspace", { workspaceId: "ws1" }),
      toolUseTurn("submit_rca", {
        summary: "Tool failed, proceeding without it",
        claims: [{ text: "Could not confirm via tooling", claimType: "HYPOTHESIS", evidenceIds: [], confidence: 0.2 }],
        confidence: 0.2,
        alternativeHypotheses: [],
      }),
    ]);

    const result = await runInvestigationAgent(incident, baseDeps(llmClient, available));
    expect(result.toolCallCount).toBe(0); // the failed call never reaches recordEvidence
    expect(result.rca.summary).toBe("Tool failed, proceeding without it");
  });

  it("nudges the model once if it returns plain text instead of a tool call", async () => {
    const llmClient = scriptedLlmClient([
      textOnlyTurn("Let me think about this."),
      toolUseTurn("submit_rca", {
        summary: "Done after nudge",
        claims: [{ text: "x", claimType: "HYPOTHESIS", evidenceIds: [], confidence: 0.3 }],
        confidence: 0.3,
        alternativeHypotheses: [],
      }),
    ]);

    const result = await runInvestigationAgent(incident, baseDeps(llmClient, []));
    expect(result.rca.summary).toBe("Done after nudge");
  });

  it("throws InvestigationIncompleteError on a refusal", async () => {
    const llmClient = scriptedLlmClient([{ stopReason: "refusal", content: [], toolUses: [] }]);
    await expect(runInvestigationAgent(incident, baseDeps(llmClient, []))).rejects.toThrow(
      InvestigationIncompleteError,
    );
  });

  it("throws InvestigationIncompleteError after exhausting maxIterations without an RCA", async () => {
    const llmClient = scriptedLlmClient([
      textOnlyTurn("still thinking"),
      textOnlyTurn("still thinking"),
      textOnlyTurn("still thinking"),
    ]);
    await expect(
      runInvestigationAgent(incident, { ...baseDeps(llmClient, []), maxIterations: 2 }),
    ).rejects.toThrow(InvestigationIncompleteError);
  });
});
