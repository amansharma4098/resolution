import { RootCauseAnalysisOutput } from "@resolution/shared";
import { zodToToolSchema, type LlmToolSpec } from "@resolution/ai";

export const SUBMIT_RCA_TOOL_NAME = "submit_rca";

/**
 * The forced structured-output step: rather than relying on `output_config.format` (which
 * can't express the FACT-claims-must-cite-evidence business rule packages/shared/src/rca.ts
 * enforces via a Zod `.refine()`), the final answer is itself a tool call — its JSON-schema
 * shape is derived directly from `RootCauseAnalysisOutput`, and investigation-agent.ts
 * re-validates the model's input against that same Zod schema (not just its JSON-schema
 * shape) before accepting it, so the `.refine()` rule is actually enforced, not just
 * documented in the tool description below.
 */
export function buildSubmitRcaToolSpec(): LlmToolSpec {
  return {
    name: SUBMIT_RCA_TOOL_NAME,
    description:
      "Submit the final root cause analysis for this incident. Call this exactly once, after gathering whatever evidence you need (or after determining no available tool can help). Every FACT claim MUST cite at least one evidenceId returned by a prior tool call result — never invent an evidenceId or state something as FACT without a citation. Use INFERENCE for reasoning that follows from evidence but isn't directly stated by it, and HYPOTHESIS for a plausible but unconfirmed explanation. A low-confidence HYPOTHESIS is far better than an unsupported FACT.",
    input_schema: zodToToolSchema(RootCauseAnalysisOutput) as LlmToolSpec["input_schema"],
  };
}
