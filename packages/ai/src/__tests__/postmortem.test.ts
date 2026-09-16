import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { draftPostmortem, type PostmortemInput } from "../postmortem";
import type { LlmClient, LlmTurnResult } from "../types";

const input: PostmortemInput = {
  incident: {
    title: "Disk usage above 95% on payments-api",
    description: "A log file grew unbounded",
    severity: "HIGH",
    priority: "P2",
    source: "DATADOG",
    service: "payments-api",
    createdAt: "2026-01-01T00:00:00.000Z",
    resolvedAt: "2026-01-01T01:00:00.000Z",
  },
  rca: {
    summary: "An unrotated log file filled the disk",
    claims: [{ text: "Disk was at 98% utilization", claimType: "FACT", confidence: 0.9 }],
    confidence: 0.9,
  },
  evidence: [{ capabilityKey: "get_disk_usage", summary: "Disk at 98%" }],
  resolutions: [{ proposedAction: "Rotate and truncate the log file", riskLevel: "LOW", outcome: "succeeded" }],
  timeline: [{ type: "resolved", actor: "system", createdAt: "2026-01-01T01:00:00.000Z" }],
};

function mockLlmClient(): LlmClient {
  return { isMock: true, async send() { throw new Error("must not be called when isMock is true"); } };
}

function scriptedLlmClient(text: string): LlmClient {
  return {
    isMock: false,
    async send(): Promise<LlmTurnResult> {
      const block: Anthropic.TextBlock = { type: "text", text, citations: [] };
      return { stopReason: "end_turn", content: [block], toolUses: [] };
    },
  };
}

describe("draftPostmortem", () => {
  it("MOCK_MODE: assembles a structured skeleton directly from the record, without calling the LLM", async () => {
    const result = await draftPostmortem(mockLlmClient(), input);
    expect(result.isMock).toBe(true);
    expect(result.content).toContain("MOCK_MODE");
    expect(result.content).toContain("## Summary");
    expect(result.content).toContain("## Root Cause");
    expect(result.content).toContain("An unrotated log file filled the disk");
    expect(result.content).toContain("## Resolution");
    expect(result.content).toContain("Rotate and truncate the log file");
  });

  it("MOCK_MODE: says plainly when there's no RCA or remediation to draw from, rather than inventing one", async () => {
    const result = await draftPostmortem(mockLlmClient(), {
      ...input,
      rca: null,
      resolutions: [],
    });
    expect(result.content).toContain("No root cause analysis was recorded");
    expect(result.content).toContain("No remediation was proposed or executed");
  });

  it("real client: returns the model's text content, concatenating multiple text blocks", async () => {
    const result = await draftPostmortem(scriptedLlmClient("## Summary\nA real drafted postmortem."), input);
    expect(result.isMock).toBe(false);
    expect(result.content).toBe("## Summary\nA real drafted postmortem.");
  });

  it("real client: sends an empty tool list and no tool-calling — this is plain text generation", async () => {
    let capturedTools: unknown;
    const client: LlmClient = {
      isMock: false,
      async send(params) {
        capturedTools = params.tools;
        const block: Anthropic.TextBlock = { type: "text", text: "ok", citations: [] };
        return { stopReason: "end_turn", content: [block], toolUses: [] };
      },
    };
    await draftPostmortem(client, input);
    expect(capturedTools).toEqual([]);
  });
});
