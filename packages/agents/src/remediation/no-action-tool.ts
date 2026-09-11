import type { LlmToolSpec } from "@resolution/ai";

export const NO_ACTION_TOOL_NAME = "no_remediation_needed";

/**
 * The honest "decline" path for the Resolution Agent — not every incident has a safe,
 * automatable fix, and forcing a capability call in every case would mean either fabricating
 * a plausible-looking action or silently picking the first available tool. Modeled the same
 * way submit_rca's contract is: a real tool the model can call instead of an action, not a
 * text response we'd have to parse and guess the intent of.
 */
export function buildNoActionToolSpec(): LlmToolSpec {
  return {
    name: NO_ACTION_TOOL_NAME,
    description:
      "Call this instead of a capability when no available capability can safely address this incident's root cause, when the root cause analysis is too uncertain to act on, or when the situation needs human judgment before any action is taken. Never call a capability just because one is available — only when it genuinely addresses the root cause.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Why no automated remediation is being proposed" } },
      required: ["reason"],
    },
  };
}
