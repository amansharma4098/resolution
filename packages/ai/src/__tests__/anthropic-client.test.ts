import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicLlmClient } from "../anthropic-client";

// Mocked-fetch, not a real call — same pattern as packages/integrations' Jira/ServiceNow
// client tests (JiraClient/ServiceNowClient). There is no ANTHROPIC_API_KEY available in
// this environment (IMPLEMENTATION_PLAN.md's Phase 7 entry), so this verifies the SDK
// request is shaped the way this client intends and that its response is mapped correctly
// — it does not, and cannot yet, verify a real model's behavior.
describe("createAnthropicLlmClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the model, system prompt, messages and tools, and maps the response back", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_workspace",
              input: { workspaceId: "ws1" },
              caller: { type: "direct" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = createAnthropicLlmClient({ apiKey: "sk-test", model: "claude-opus-5" });
    const result = await client.send({
      system: "You are the investigation agent.",
      messages: [{ role: "user", content: "Investigate this incident." }],
      tools: [{ name: "get_workspace", description: "x", input_schema: { type: "object" } }],
    });

    expect(client.isMock).toBe(false);
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0]!.name).toBe("get_workspace");
    expect(result.toolUses[0]!.input).toEqual({ workspaceId: "ws1" });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-opus-5");
    expect(body.system).toBe("You are the investigation agent.");
    expect(body.tools[0].name).toBe("get_workspace");
    expect(body.thinking).toEqual({ type: "adaptive" });
  });
});
