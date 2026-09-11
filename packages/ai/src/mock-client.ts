import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmMessage, LlmTurnResult } from "./types";

/** Walks a JSON-schema object and produces a minimal, schema-conformant sample value — just
 *  enough for the mock client to call a real tool with valid input, never enough to be
 *  mistaken for a considered choice of arguments. */
function sampleFromJsonSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  switch (s.type) {
    case "string":
      return typeof s.default === "string" ? s.default : "mock-value";
    case "number":
    case "integer":
      return typeof s.default === "number" ? s.default : 1;
    case "boolean":
      return typeof s.default === "boolean" ? s.default : true;
    case "array":
      return [];
    case "object": {
      const props = (s.properties as Record<string, unknown>) ?? {};
      const required = Array.isArray(s.required) ? (s.required as string[]) : Object.keys(props);
      const out: Record<string, unknown> = {};
      for (const key of required) {
        if (key in props) out[key] = sampleFromJsonSchema(props[key]);
      }
      return out;
    }
    default:
      return null;
  }
}

/** Scans prior tool_result blocks in the conversation for the `evidenceId` our own tool
 *  wrapper embeds in every successful capability call's result (see packages/agents'
 *  investigation-agent.ts) — lets the mock's final RCA cite real, persisted evidence the
 *  same way a real model would, instead of a fabricated id. */
function extractEvidenceIds(messages: LlmMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (typeof block !== "object" || block === null || (block as { type?: string }).type !== "tool_result") {
        continue;
      }
      const raw = (block as Anthropic.ToolResultBlockParam).content;
      const text = typeof raw === "string" ? raw : Array.isArray(raw) ? JSON.stringify(raw) : "";
      try {
        const parsed = JSON.parse(text) as { evidenceId?: unknown };
        if (typeof parsed.evidenceId === "string") ids.push(parsed.evidenceId);
      } catch {
        // Not a JSON tool_result (e.g. an error string) — nothing to extract.
      }
    }
  }
  return ids;
}

function hasCalledAnyTool(messages: LlmMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      Array.isArray(m.content) &&
      m.content.some((b) => typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use"),
  );
}

/**
 * MOCK_MODE's LLM client — used whenever no ANTHROPIC_API_KEY is configured, which is the
 * standing MVP requirement (README.md / IMPLEMENTATION_PLAN.md): the full investigation → RCA
 * pipeline must run end to end with zero production credentials, honestly labeled rather than
 * silently faked. It is not a canned-response stub: it reads the real tool catalog it's
 * offered and the real tool_result content the investigation loop feeds back (including
 * genuine evidenceIds written to IncidentEvidence), so everything downstream of the LLM call
 * — evidence persistence, citation enforcement, state transitions — runs for real. What it
 * does not do is anything resembling reasoning about the incident; its own RCA output says so
 * (low confidence, explicit caveat) rather than pretending to have diagnosed anything.
 */
export function createMockLlmClient(): LlmClient {
  return {
    isMock: true,
    async send({ messages, tools }): Promise<LlmTurnResult> {
      const submitTool = tools.find((t) => t.name === "submit_rca");
      const otherTools = tools.filter((t) => t.name !== "submit_rca");

      if (otherTools.length > 0 && !hasCalledAnyTool(messages)) {
        const tool = otherTools[0]!;
        const block: Anthropic.ToolUseBlock = {
          type: "tool_use",
          id: `mock_${crypto.randomUUID()}`,
          name: tool.name,
          input: sampleFromJsonSchema(tool.input_schema),
          caller: { type: "direct" },
        };
        return { stopReason: "tool_use", content: [block], toolUses: [block] };
      }

      if (!submitTool) {
        const text: Anthropic.TextBlock = {
          type: "text",
          text: "MOCK_MODE: no submit_rca tool was offered, and no ANTHROPIC_API_KEY is configured — nothing to do.",
          citations: [],
        };
        return { stopReason: "end_turn", content: [text], toolUses: [] };
      }

      const evidenceIds = extractEvidenceIds(messages);
      const rcaInput = {
        summary:
          "MOCK_MODE analysis: no ANTHROPIC_API_KEY is configured for this deployment, so this is a deterministic placeholder, not a real diagnosis. Set ANTHROPIC_API_KEY and MOCK_MODE=false to enable real investigation.",
        claims:
          evidenceIds.length > 0
            ? [
                {
                  text: "Evidence was collected from this organization's configured Map Server capabilities and is available for human review.",
                  claimType: "FACT",
                  evidenceIds,
                  confidence: 0.5,
                },
                {
                  text: "The actual root cause cannot be determined — no real LLM is configured in this environment.",
                  claimType: "HYPOTHESIS",
                  evidenceIds: [],
                  confidence: 0.1,
                },
              ]
            : [
                {
                  text: "No tool access was available and no real LLM is configured — this incident needs manual investigation.",
                  claimType: "HYPOTHESIS",
                  evidenceIds: [],
                  confidence: 0.1,
                },
              ],
        confidence: 0.2,
        alternativeHypotheses: ["Configure a real ANTHROPIC_API_KEY (MOCK_MODE=false) for an actual root cause analysis."],
      };

      const block: Anthropic.ToolUseBlock = {
        type: "tool_use",
        id: `mock_${crypto.randomUUID()}`,
        name: submitTool.name,
        input: rcaInput,
        caller: { type: "direct" },
      };
      return { stopReason: "tool_use", content: [block], toolUses: [block] };
    },
  };
}
