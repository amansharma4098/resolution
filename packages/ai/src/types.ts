import type Anthropic from "@anthropic-ai/sdk";

/**
 * We deliberately reuse the Anthropic SDK's own request/response types instead of inventing
 * a parallel message/content-block model (see the skill guidance this was built against:
 * "don't redefine equivalent interfaces"). `LlmMessage` doubles as conversation history —
 * `response.content` from one turn is pushed back verbatim as the next turn's assistant
 * message, which is also how Anthropic's own docs show preserving tool_use/thinking blocks
 * across a multi-turn tool-calling loop.
 */
export type LlmMessage = Anthropic.MessageParam;
export type LlmToolSpec = Anthropic.Tool;

export interface LlmTurnResult {
  stopReason: Anthropic.Message["stop_reason"];
  /** The full, unmodified content block array from this turn — callers must push this back
   *  as the next assistant message's content, not a reconstruction from just the text/tool
   *  calls, so thinking blocks and any other opaque block types survive the round trip. */
  content: Anthropic.ContentBlock[];
  toolUses: Anthropic.ToolUseBlock[];
}

/**
 * One provider-agnostic seam between packages/agents' investigation loop and whichever LLM
 * actually runs it. `isMock` lets callers label results honestly (e.g. on the RCA's stored
 * metadata) rather than a caller having to guess from behavior.
 */
export interface LlmClient {
  readonly isMock: boolean;
  send(params: { system: string; messages: LlmMessage[]; tools: LlmToolSpec[] }): Promise<LlmTurnResult>;
}
