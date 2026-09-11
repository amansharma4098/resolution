import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmTurnResult } from "./types";

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * The real LLM path — used whenever an ANTHROPIC_API_KEY is configured and MOCK_MODE is off
 * (see factory.ts). Not exercised by this project's own test suite (no production API key is
 * available in this environment — see IMPLEMENTATION_PLAN.md's Phase 7 entry) beyond a
 * mocked-fetch unit test of the request/response mapping; the mock client in mock-client.ts
 * is what exercises the full investigation → RCA pipeline in CI and local dev.
 *
 * Adaptive thinking is requested explicitly even though it's Opus 5's default — this client
 * also accepts other current models via `model`, and non-Opus-5 models need it stated
 * explicitly to opt in. Non-streaming: the investigation loop's individual turns are short
 * (a handful of tool calls and a bounded RCA JSON payload, not a long generated document), so
 * this stays well under the SDK's streaming-required output size.
 */
export function createAnthropicLlmClient(opts: { apiKey: string; model?: string }): LlmClient {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    isMock: false,
    async send({ system, messages, tools }): Promise<LlmTurnResult> {
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        messages,
        tools,
        thinking: { type: "adaptive" },
      });

      return {
        stopReason: response.stop_reason,
        content: response.content,
        toolUses: response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        ),
      };
    },
  };
}
