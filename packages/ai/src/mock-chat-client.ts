import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmTurnResult } from "./types";

/**
 * MOCK_MODE's LLM client for the in-app chat assistant (apps/api/src/routes/chat.ts) — a
 * deliberately different mock from mock-client.ts's, which is shaped specifically around
 * the investigation agent's submit_rca loop and would either call an arbitrary first tool
 * or immediately dead-end for a general conversation, neither of which is an honest
 * "MOCK_MODE" answer to a free-form chat message. Reasoning about what a user's message
 * means and which tool (if any) answers it is exactly the part that needs a real LLM — a
 * canned tool call here would misrepresent that as working. The tool-calling loop itself,
 * and every tool it can call, are fully real regardless of this client — only the model
 * judgment behind them needs a real ANTHROPIC_API_KEY (MOCK_MODE=false).
 */
export function createMockChatClient(): LlmClient {
  return {
    isMock: true,
    async send(): Promise<LlmTurnResult> {
      const text: Anthropic.TextBlock = {
        type: "text",
        citations: [],
        text: "MOCK_MODE: no ANTHROPIC_API_KEY is configured for this deployment, so the assistant can't reason about your message yet. The tool-calling loop and every tool it can call (list/get incidents, get RCA, investigate, propose remediation, approve) are fully real — set ANTHROPIC_API_KEY and MOCK_MODE=false to enable real conversation.",
      };
      return { stopReason: "end_turn", content: [text], toolUses: [] };
    },
  };
}
