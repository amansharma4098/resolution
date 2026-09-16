import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "./types";

/** The subset of an incident's full history the draft is written from — structural types
 *  (not imports of @resolution/database's rows) so this package stays independent of the
 *  persistence layer, same reasoning as packages/agents' InvestigationIncidentInput. */
export interface PostmortemInput {
  incident: {
    title: string;
    description: string;
    severity: string;
    priority: string;
    source: string;
    service?: string | null;
    createdAt: string;
    resolvedAt?: string | null;
  };
  rca: { summary: string; claims: { text: string; claimType: string; confidence: number }[]; confidence: number } | null;
  evidence: { capabilityKey: string | null; summary: string }[];
  resolutions: { proposedAction: string; riskLevel: string; outcome: string }[];
  timeline: { type: string; actor: string; createdAt: string }[];
}

export interface PostmortemResult {
  content: string;
  isMock: boolean;
}

function buildSystemPrompt(): string {
  return [
    "You write incident postmortems (retrospectives) for an engineering team.",
    "You are given the complete, real record of one incident — its root cause analysis, the evidence gathered, the remediation actions taken and their outcomes, and a timeline of what happened.",
    "Write ONLY from what is given to you — never invent details, root causes, or action items not supported by the record.",
    "Produce clean Markdown with these sections, in this order: ## Summary, ## Timeline, ## Root Cause, ## Impact, ## Resolution, ## Action Items.",
    "Action Items must be concrete and preventive (what changes to make so this class of incident is less likely or less severe next time) — if the record gives no basis for a specific action item, say so plainly rather than inventing one.",
    "Keep it blameless: describe what the system and the agent did, never who is at fault.",
  ].join("\n");
}

function buildUserContent(input: PostmortemInput): string {
  const lines = [
    `Incident: ${input.incident.title}`,
    `Source: ${input.incident.source}  Severity: ${input.incident.severity}  Priority: ${input.incident.priority}`,
    input.incident.service ? `Service: ${input.incident.service}` : "",
    `Opened: ${input.incident.createdAt}`,
    input.incident.resolvedAt ? `Resolved: ${input.incident.resolvedAt}` : "",
    "",
    `Description: ${input.incident.description}`,
    "",
  ];

  if (input.rca) {
    lines.push(`Root cause analysis (confidence ${Math.round(input.rca.confidence * 100)}%): ${input.rca.summary}`);
    for (const claim of input.rca.claims) {
      lines.push(`- [${claim.claimType}, ${Math.round(claim.confidence * 100)}% confidence] ${claim.text}`);
    }
    lines.push("");
  } else {
    lines.push("No root cause analysis was recorded for this incident.", "");
  }

  if (input.evidence.length > 0) {
    lines.push("Evidence gathered:");
    for (const e of input.evidence) lines.push(`- ${e.capabilityKey ?? "unknown capability"}: ${e.summary}`);
    lines.push("");
  }

  if (input.resolutions.length > 0) {
    lines.push("Remediation actions:");
    for (const r of input.resolutions) lines.push(`- ${r.proposedAction} (risk: ${r.riskLevel}) — outcome: ${r.outcome}`);
    lines.push("");
  } else {
    lines.push("No remediation was proposed or executed for this incident.", "");
  }

  if (input.timeline.length > 0) {
    lines.push("Timeline:");
    for (const t of input.timeline) lines.push(`- ${t.createdAt}: ${t.type} (${t.actor})`);
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

/** Assembled directly from the stored record, not a written narrative — the honest
 *  MOCK_MODE fallback (mirrors mock-chat-client.ts's reasoning: judging what happened and
 *  writing it up is exactly the part that needs a real LLM; a canned paragraph here would
 *  misrepresent that as done). Every section still reflects real data. */
function mockPostmortem(input: PostmortemInput): string {
  const lines = [
    "> **MOCK_MODE**: no `ANTHROPIC_API_KEY` is configured for this deployment, so this is a" +
      " structured skeleton assembled directly from the stored record, not a written" +
      " narrative. Set `ANTHROPIC_API_KEY` and `MOCK_MODE=false` for a real draft.",
    "",
    "## Summary",
    input.incident.title,
    "",
    "## Timeline",
    ...(input.timeline.length > 0
      ? input.timeline.map((t) => `- ${t.createdAt}: ${t.type} (${t.actor})`)
      : ["No timeline events recorded."]),
    "",
    "## Root Cause",
    input.rca ? input.rca.summary : "No root cause analysis was recorded for this incident.",
    "",
    "## Impact",
    `${input.incident.severity} severity, ${input.incident.priority} priority` +
      (input.incident.service ? ` on ${input.incident.service}` : "") +
      ".",
    "",
    "## Resolution",
    ...(input.resolutions.length > 0
      ? input.resolutions.map((r) => `- ${r.proposedAction} — outcome: ${r.outcome}`)
      : ["No remediation was proposed or executed for this incident."]),
    "",
    "## Action Items",
    "Not generated — MOCK_MODE cannot judge what preventive action this record supports.",
  ];
  return lines.join("\n");
}

/** Drafts a Markdown postmortem from an incident's complete real record. Not agentic — a
 *  single plain-text generation, so it reuses the same `LlmClient.send` seam as the
 *  investigation/chat clients with an empty tool list rather than needing a new provider
 *  abstraction. */
export async function draftPostmortem(llmClient: LlmClient, input: PostmortemInput): Promise<PostmortemResult> {
  if (llmClient.isMock) {
    return { content: mockPostmortem(input), isMock: true };
  }

  const turn = await llmClient.send({
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserContent(input) }],
    tools: [],
  });

  const text = turn.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();

  return { content: text || "_The model returned no content for this postmortem._", isMock: false };
}
