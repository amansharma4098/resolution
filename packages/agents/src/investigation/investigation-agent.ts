import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmMessage } from "@resolution/ai";
import { RootCauseAnalysisOutput } from "@resolution/shared";
import type { RootCauseAnalysisOutput as RcaOutput } from "@resolution/shared";
import type { AnyCapability, MapServerContext } from "@resolution/map-servers";
import { buildCapabilityToolSpecs, toolNameFor, type AvailableCapability } from "./tool-catalog";

export type { AvailableCapability } from "./tool-catalog";
import { buildSubmitRcaToolSpec, SUBMIT_RCA_TOOL_NAME } from "./submit-rca-tool";

const DEFAULT_MAX_ITERATIONS = 6;

export class InvestigationIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestigationIncompleteError";
  }
}

/** The subset of an Incident the agent's prompt needs — a structural type, not an import of
 *  @resolution/database's `Incident`, so this package stays independent of the persistence
 *  layer (apps/api's queue consumer passes its own Incident value in; it matches this shape
 *  by construction). */
export interface InvestigationIncidentInput {
  title: string;
  description: string;
  severity: string;
  priority: string;
  source: string;
  service?: string | null;
  environment?: string | null;
}

export type EvidenceRecorder = (entry: {
  mapServerId: string;
  capabilityKey: string;
  summary: string;
  payload: unknown;
}) => Promise<string>; // resolves to the persisted evidence's id

export interface InvestigationAgentDeps {
  llmClient: LlmClient;
  /** Every read-only capability the org has enabled, across all its configured Map Servers —
   *  ARCHITECTURE.md §4: the agent only ever sees what's been explicitly turned on. */
  availableCapabilities: AvailableCapability[];
  /** Builds the MapServerContext (incl. decrypted credential) for one call — deferred to a
   *  callback, not built once up front, so a credential is only ever decrypted for a
   *  capability the model actually decides to call. */
  contextFor: (mapServerId: string, capability: AnyCapability) => Promise<MapServerContext>;
  /** Persists one IncidentEvidence row per successful tool call; returns its id so the model
   *  can cite it on a FACT claim. */
  recordEvidence: EvidenceRecorder;
  maxIterations?: number;
}

export interface InvestigationAgentResult {
  rca: RcaOutput;
  toolCallCount: number;
  messages: LlmMessage[];
}

function buildSystemPrompt(incident: InvestigationIncidentInput): string {
  return [
    "You are the Investigation and Root Cause Analysis agent for an AI incident resolution platform.",
    "Investigate this incident using ONLY the tools you are given — never invent facts, logs, metrics, or data you did not retrieve from a tool call.",
    "Each successful tool call's result includes an evidenceId — cite it on any FACT claim that relies on it.",
    "When you have gathered enough evidence (or have determined the available tools cannot tell you more), call submit_rca exactly once with your final analysis.",
    "Be honest about uncertainty: a low-confidence HYPOTHESIS is far better than a confident FACT you cannot back with evidence.",
    "",
    `Incident: ${incident.title}`,
    `Source: ${incident.source}  Severity: ${incident.severity}  Priority: ${incident.priority}`,
    incident.service ? `Service: ${incident.service}` : "",
    incident.environment ? `Environment: ${incident.environment}` : "",
    "",
    `Description: ${incident.description}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * The manual tool-calling loop (Claude API "approach 1" — see this phase's design notes):
 * written by hand rather than via the SDK's beta Tool Runner because the tool list is
 * assembled dynamically per organization from the Map Server registry, and every tool call
 * needs bespoke side effects (decrypt-on-demand credentials, IncidentEvidence persistence)
 * the Tool Runner's generic per-turn hooks don't fit as directly as owning the loop does.
 *
 * Bounded by `maxIterations` on purpose — Cloudflare Workers bill/limit wall-clock CPU time,
 * and an agent that can't converge on an RCA within a handful of turns should escalate to a
 * human (via InvestigationIncompleteError, caught by the caller) rather than loop
 * indefinitely.
 */
export async function runInvestigationAgent(
  incident: InvestigationIncidentInput,
  deps: InvestigationAgentDeps,
): Promise<InvestigationAgentResult> {
  const { llmClient, availableCapabilities, contextFor, recordEvidence } = deps;
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const capabilityByToolName = new Map(
    availableCapabilities.map((c) => [toolNameFor(c.mapServerId, c.capability.key), c] as const),
  );
  const tools = [...buildCapabilityToolSpecs(availableCapabilities), buildSubmitRcaToolSpec()];
  const system = buildSystemPrompt(incident);
  const messages: LlmMessage[] = [
    { role: "user", content: "Investigate this incident and produce a root cause analysis." },
  ];

  let toolCallCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const turn = await llmClient.send({ system, messages, tools });

    if (turn.stopReason === "refusal") {
      throw new InvestigationIncompleteError("The model declined to investigate this incident (refusal)");
    }

    // Echo the full content block array back verbatim — not a reconstruction from just text
    // or tool calls — so thinking blocks (and any other opaque block type) survive the round
    // trip, per Anthropic's multi-turn contract.
    messages.push({ role: "assistant", content: turn.content });

    if (turn.toolUses.length === 0) {
      messages.push({
        role: "user",
        content:
          "You must call a tool to gather evidence, or call submit_rca to finish. Do not respond with plain text only.",
      });
      continue;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let submittedRca: RcaOutput | null = null;

    for (const toolUse of turn.toolUses) {
      if (toolUse.name === SUBMIT_RCA_TOOL_NAME) {
        const parsed = RootCauseAnalysisOutput.safeParse(toolUse.input);
        if (!parsed.success) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `Invalid RCA: ${parsed.error.message}. Fix it and call submit_rca again.`,
          });
          continue;
        }
        submittedRca = parsed.data;
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: "Accepted." });
        continue;
      }

      const match = capabilityByToolName.get(toolUse.name);
      if (!match) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Unknown tool "${toolUse.name}".`,
        });
        continue;
      }

      const inputParsed = match.capability.inputSchema.safeParse(toolUse.input);
      if (!inputParsed.success) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Invalid input: ${inputParsed.error.message}`,
        });
        continue;
      }

      try {
        const ctx = await contextFor(match.mapServerId, match.capability);
        const output = await match.capability.execute(ctx, inputParsed.data);
        toolCallCount++;
        const evidenceId = await recordEvidence({
          mapServerId: match.mapServerId,
          capabilityKey: match.capability.key,
          summary: `${match.capability.key} on ${match.mapServerType}`,
          payload: output,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify({ evidenceId, result: output }),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (submittedRca) {
      return { rca: submittedRca, toolCallCount, messages };
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new InvestigationIncompleteError(
    `Investigation did not reach a root cause analysis within ${maxIterations} iterations`,
  );
}
