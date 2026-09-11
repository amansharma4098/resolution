import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmMessage } from "@resolution/ai";
import type { RootCauseAnalysisOutput } from "@resolution/shared";
import type { AnyCapability, MapServerType } from "@resolution/map-servers";
import { buildCapabilityToolSpecs, toolNameFor, type AvailableCapability } from "../investigation/tool-catalog";
import type { InvestigationIncidentInput } from "../investigation/investigation-agent";
import { buildNoActionToolSpec, NO_ACTION_TOOL_NAME } from "./no-action-tool";

const DEFAULT_MAX_ITERATIONS = 3;

export class ResolutionIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionIncompleteError";
  }
}

export interface ResolutionProposal {
  mapServerId: string;
  mapServerType: MapServerType;
  capability: AnyCapability;
  input: unknown;
  proposedAction: string;
}

export type ResolutionAgentResult =
  | { kind: "proposed"; proposal: ResolutionProposal }
  | { kind: "no_action"; reason: string };

export interface ResolutionAgentDeps {
  llmClient: LlmClient;
  /** Must already be filtered to mutating, enabled capabilities — this agent doesn't
   *  re-check either condition, same contract as the Investigation Agent's read-only list. */
  availableCapabilities: AvailableCapability[];
  maxIterations?: number;
}

function buildSystemPrompt(): string {
  return [
    "You are the Resolution agent for an AI incident resolution platform.",
    "You are given an incident and its completed root cause analysis. Propose exactly one remediation action by calling exactly one of the available capability tools with valid input — the action that most directly addresses the root cause.",
    "If no available capability genuinely addresses the root cause, or the analysis is too uncertain to act on, call no_remediation_needed with a clear reason instead. Do not call a capability just because one exists.",
    "Never invent a capability, field, or value that wasn't offered to you or stated in the root cause analysis.",
  ].join("\n");
}

function buildUserMessage(incident: InvestigationIncidentInput, rca: RootCauseAnalysisOutput): string {
  const claims = rca.claims.map((c) => `- [${c.claimType}, confidence ${c.confidence}] ${c.text}`).join("\n");
  return [
    `Incident: ${incident.title}`,
    `Source: ${incident.source}  Severity: ${incident.severity}  Priority: ${incident.priority}`,
    "",
    `Root cause analysis (overall confidence ${rca.confidence}):`,
    rca.summary,
    "",
    "Claims:",
    claims,
    rca.alternativeHypotheses.length > 0
      ? `\nAlternative hypotheses:\n${rca.alternativeHypotheses.map((h) => `- ${h}`).join("\n")}`
      : "",
    "",
    "Propose the single best remediation action, or decline if none applies.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * A bounded, mostly-one-shot tool-calling loop (same manual-loop rationale as the
 * Investigation Agent — see its header comment) that turns a completed RCA into at most one
 * proposed `Resolution` + `RemediationAction`. Deliberately does NOT execute the capability
 * it proposes — that happens later, only after the policy engine (packages/agents/src/
 * policy-engine.ts) and, if required, a human approval, per ARCHITECTURE.md §7.
 */
export async function runResolutionAgent(
  incident: InvestigationIncidentInput,
  rca: RootCauseAnalysisOutput,
  deps: ResolutionAgentDeps,
): Promise<ResolutionAgentResult> {
  const { llmClient, availableCapabilities } = deps;
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  if (availableCapabilities.length === 0) {
    return { kind: "no_action", reason: "No mutating capabilities are enabled for this organization" };
  }

  const capabilityByToolName = new Map(
    availableCapabilities.map((c) => [toolNameFor(c.mapServerId, c.capability.key), c] as const),
  );
  const tools = [...buildCapabilityToolSpecs(availableCapabilities), buildNoActionToolSpec()];
  const system = buildSystemPrompt();
  const messages: LlmMessage[] = [{ role: "user", content: buildUserMessage(incident, rca) }];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const turn = await llmClient.send({ system, messages, tools });

    if (turn.stopReason === "refusal") {
      throw new ResolutionIncompleteError("The model declined to propose a remediation (refusal)");
    }

    messages.push({ role: "assistant", content: turn.content });

    if (turn.toolUses.length === 0) {
      messages.push({
        role: "user",
        content: "You must call a capability tool or no_remediation_needed. Do not respond with plain text only.",
      });
      continue;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let outcome: ResolutionAgentResult | null = null;

    for (const toolUse of turn.toolUses) {
      if (outcome) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Ignored — only one remediation action may be proposed per run.",
        });
        continue;
      }

      if (toolUse.name === NO_ACTION_TOOL_NAME) {
        const input = toolUse.input as { reason?: unknown };
        const reason = typeof input.reason === "string" && input.reason.length > 0 ? input.reason : "No reason given";
        outcome = { kind: "no_action", reason };
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

      const parsed = match.capability.inputSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Invalid input: ${parsed.error.message}`,
        });
        continue;
      }

      outcome = {
        kind: "proposed",
        proposal: {
          mapServerId: match.mapServerId,
          mapServerType: match.mapServerType,
          capability: match.capability,
          input: parsed.data,
          proposedAction: `${match.capability.description} (${match.capability.key})`,
        },
      };
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: "Accepted." });
    }

    if (outcome) return outcome;

    messages.push({ role: "user", content: toolResults });
  }

  throw new ResolutionIncompleteError(
    `Resolution agent did not reach a proposal within ${maxIterations} iterations`,
  );
}
