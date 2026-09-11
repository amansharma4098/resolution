import { describe, expect, it } from "vitest";
import { RootCauseAnalysisOutput } from "@resolution/shared";
import { createMockLlmClient } from "../mock-client";
import type { LlmMessage, LlmToolSpec } from "../types";

const getWorkspaceTool: LlmToolSpec = {
  name: "srv1__get_workspace",
  description: "Fetch a workspace",
  input_schema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
};

const submitRcaTool: LlmToolSpec = {
  name: "submit_rca",
  description: "Submit the final RCA",
  input_schema: { type: "object", properties: {}, required: [] },
};

describe("createMockLlmClient", () => {
  it("calls the first non-submit_rca tool with schema-conformant input when no tool has run yet", async () => {
    const client = createMockLlmClient();
    const result = await client.send({ system: "", messages: [{ role: "user", content: "go" }], tools: [getWorkspaceTool, submitRcaTool] });

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0]!.name).toBe("srv1__get_workspace");
    expect(result.toolUses[0]!.input).toMatchObject({ workspaceId: expect.any(String) });
  });

  it("goes straight to submit_rca when only submit_rca is offered", async () => {
    const client = createMockLlmClient();
    const result = await client.send({ system: "", messages: [{ role: "user", content: "go" }], tools: [submitRcaTool] });

    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0]!.name).toBe("submit_rca");
    const parsed = RootCauseAnalysisOutput.safeParse(result.toolUses[0]!.input);
    expect(parsed.success).toBe(true);
  });

  it("calls submit_rca once a tool has already run, citing evidenceIds it finds in prior tool_result content", async () => {
    const client = createMockLlmClient();
    const messages: LlmMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "srv1__get_workspace", input: {}, caller: { type: "direct" } }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: JSON.stringify({ evidenceId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", result: { id: "ws1" } }),
          },
        ],
      },
    ];

    const result = await client.send({ system: "", messages, tools: [getWorkspaceTool, submitRcaTool] });

    expect(result.toolUses[0]!.name).toBe("submit_rca");
    const parsed = RootCauseAnalysisOutput.safeParse(result.toolUses[0]!.input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const factClaims = parsed.data.claims.filter((c) => c.claimType === "FACT");
      expect(factClaims.length).toBeGreaterThan(0);
      expect(factClaims[0]!.evidenceIds).toContain("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    }
  });
});
