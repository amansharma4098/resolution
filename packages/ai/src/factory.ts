import { createAnthropicLlmClient } from "./anthropic-client";
import { createMockLlmClient } from "./mock-client";
import type { LlmClient } from "./types";

export interface LlmConfig {
  /** Mirrors env.MOCK_MODE. Wins over `apiKey` on purpose — a deployment that hasn't
   *  explicitly flipped MOCK_MODE off never accidentally spends money on a real LLM call
   *  just because a key happens to be set. */
  mockMode: boolean;
  apiKey?: string;
  model?: string;
}

export function createLlmClient(config: LlmConfig): LlmClient {
  if (config.mockMode || !config.apiKey) {
    return createMockLlmClient();
  }
  return createAnthropicLlmClient({ apiKey: config.apiKey, model: config.model });
}
