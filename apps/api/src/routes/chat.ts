import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient, OrganizationRepository } from "@resolution/database";
import type { SecretProvider } from "@resolution/credentials";
import type { LlmClient, LlmMessage, LlmToolSpec } from "@resolution/ai";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { resolveTenantContext } from "../middleware/tenant-context";
import { TOOLS, callIncidentTool } from "../lib/incident-tools";
import { ValidationError, NotFoundError, ConflictError } from "../lib/errors";
import type { AppEnv } from "../types";
import type { IncidentInvestigationQueue, IncidentRemediationQueue } from "../queue/types";

// A chat turn can legitimately need several tool calls (list, then get detail, then get
// RCA, then decide) — higher than the investigation agent's bound (packages/agents'
// DEFAULT_MAX_ITERATIONS = 6) since a conversational back-and-forth naturally takes more
// round trips than one focused investigation loop, but still bounded: Cloudflare Workers
// bill/limit wall-clock CPU time, and an assistant that can't converge within a generous
// budget should say so rather than loop indefinitely.
const MAX_ITERATIONS = 10;

/** One raw content block, loosely typed on purpose — apps/api has never taken a direct
 *  dependency on the Anthropic SDK's types (that boundary lives in packages/ai/packages/
 *  agents); a tool_result block's shape is small and stable enough to describe here
 *  structurally rather than pulling in the SDK just for this one type. */
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

const ChatBody = z
  .object({
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(10000).optional(),
    // Compatibility for a single initial user message; never accept client tool history.
    messages: z
      .array(
        z
          .object({ role: z.literal("user"), content: z.string().trim().min(1).max(10000) })
          .strict(),
      )
      .length(1)
      .optional(),
  })
  .strict()
  .refine((body) => Boolean(body.message) !== Boolean(body.messages), "Send one user message");

/**
 * The tool catalog's Anthropic-facing view, with `tenantId` stripped from every
 * schema — the chat is already scoped to one organization (the same `X-Tenant-Id`
 * header every other dashboard route reads), so the model never needs to know or guess an
 * id. `callChatTool` always injects the real one from the resolved tenant context before
 * executing, overriding anything the model supplies — one less thing that can go wrong from
 * a model hallucinating or mistyping an id.
 */
function chatToolSpecs(): LlmToolSpec[] {
  return TOOLS.filter((tool) => tool.name !== "decide_approval").map((tool): LlmToolSpec => {
    const properties = { ...(tool.inputSchema.properties as Record<string, unknown>) };
    delete properties.tenantId;
    const required = (tool.inputSchema.required as readonly string[]).filter(
      (key) => key !== "tenantId",
    );
    return {
      name: tool.name,
      description: tool.description,
      input_schema: { type: "object", properties, required },
    };
  });
}

function buildSystemPrompt(organizationName: string): string {
  return [
    `You are the FixCaptain assistant, embedded in the incident-response dashboard for "${organizationName}".`,
    "You can list and inspect incidents, read their root cause analysis, start an investigation, propose a remediation, and direct the user to the Approvals page — using only the tools you're given, never inventing incident data. You are already scoped to this one organization; never ask the user which organization they mean.",
    "When listing incidents, always group and present them by `source` (the platform each one came from — JIRA, SERVICENOW, WEBHOOK) unless the user asks for a flat list.",
    "When asked to \"resolve\" an incident: check its current status first (get_incident). If it hasn't been investigated yet, call trigger_investigation and tell the user investigation has started — it can run asynchronously in production, so a remediation may not be proposable immediately; say to check back shortly if propose_remediation reports the RCA isn't complete yet. Once RCA_COMPLETE, call propose_remediation — you never need to name or guess which system performs the fix; FixCaptain automatically picks whichever connected system (including any org-configured MCP server) can actually do it.",
    "If a remediation ends up PENDING_APPROVAL, tell the user what was proposed and its risk level, and ask whether to approve it — approval must be performed by an authorized user in the Approvals page, never by chat.",
    "Be concise. Always mention an incident's id/title so the user can find it in the dashboard, and an approval's id when one exists.",
  ].join("\n");
}

export interface ChatRouteDeps {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
  investigationQueue: IncidentInvestigationQueue;
  remediationQueue: IncidentRemediationQueue;
  secretProvider: SecretProvider;
  llmClient: LlmClient;
}

/**
 * The in-app dashboard assistant — same tool catalog and execution as `POST /api/mcp`
 * (../lib/incident-tools.ts), just reached via a chat UI inside the product instead of an
 * external MCP client, and session- rather than API-key-authenticated. The manual
 * tool-calling loop mirrors packages/agents' investigation-agent.ts (see its header
 * comment for why this is hand-written rather than the SDK's Tool Runner): the tool list
 * here is dynamic per this endpoint's own catalog, and every tool call needs the bespoke
 * tenantId injection above.
 */
export function buildChatRoutes(deps: ChatRouteDeps): Hono<AppEnv> {
  const { organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(deps.env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);

  const scope = (c: import("hono").Context<AppEnv>) => ({
    tenantId: c.get("tenantId")!,
    userId: c.get("userId")!,
  });
  router.get("/conversations", auth, tenantContext, async (c) => {
    const conversations = await deps.db.chatConversation.findMany({
      where: scope(c),
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    });
    return c.json({ conversations });
  });
  router.get("/conversations/:id", auth, tenantContext, async (c) => {
    const row = await deps.db.chatConversation.findFirst({
      where: { ...scope(c), id: c.req.param("id") },
    });
    if (!row) throw new NotFoundError("Conversation not found");
    return c.json({ conversationId: row.id, messages: JSON.parse(row.messages) });
  });
  router.delete("/conversations/:id", auth, tenantContext, async (c) => {
    const removed = await deps.db.chatConversation.deleteMany({
      where: { ...scope(c), id: c.req.param("id"), lockedUntil: { lte: Date.now() } },
    });
    if (!removed.count) throw new NotFoundError("Conversation not found or currently in use");
    return c.body(null, 204);
  });

  router.post("/", auth, tenantContext, async (c) => {
    const body = ChatBody.parse(await c.req.json());
    const { tenantId, userId } = scope(c);
    const message = body.message ?? body.messages![0]!.content;
    const requestId = c.get("requestId");
    let conversation = body.conversationId
      ? await deps.db.chatConversation.findFirst({
          where: { ...scope(c), id: body.conversationId },
        })
      : await deps.db.chatConversation.create({
          data: { ...scope(c), title: message.slice(0, 100) },
        });
    if (!conversation) throw new NotFoundError("Conversation not found");
    const lease = Date.now() + 15 * 60_000;
    const claimed = await deps.db.chatConversation.updateMany({
      where: { ...scope(c), id: conversation.id, lockedUntil: { lte: Date.now() } },
      data: { lockedUntil: lease },
    });
    if (!claimed.count)
      throw new ConflictError("This conversation is already processing a message");
    // Reload after acquiring the lease so a previous concurrent turn cannot be lost.
    conversation = (await deps.db.chatConversation.findFirst({
      where: { ...scope(c), id: conversation.id },
    }))!;
    const messages = JSON.parse(conversation.messages) as LlmMessage[];
    try {
      if (messages.length > 180) throw new ValidationError("Start a new conversation to continue");
      messages.push({ role: "user", content: message });
      const organization = await organizationRepository.findById(tenantId);
      const system = buildSystemPrompt(organization?.name ?? "your organization");
      const tools = chatToolSpecs();
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const turn = await deps.llmClient.send({ system, messages, tools });
        messages.push({ role: "assistant", content: turn.content });
        if (turn.toolUses.length === 0) {
          return c.json({
            conversationId: conversation.id,
            messages,
            isMock: deps.llmClient.isMock,
          });
        }
        const toolResults: ToolResultBlock[] = [];
        for (const toolUse of turn.toolUses) {
          const result =
            toolUse.name === "decide_approval"
              ? {
                  isError: true,
                  content: [
                    {
                      text: "Approval requires an ADMIN or OWNER to review the exact action in the Approvals page. Chat cannot approve actions.",
                    },
                  ],
                }
              : await callIncidentTool(deps, userId, requestId, toolUse.name, {
                  ...(toolUse.input as Record<string, unknown>),
                  tenantId,
                });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result.content.map((block) => block.text).join("\n"),
            is_error: result.isError,
          });
        }
        messages.push({ role: "user", content: toolResults } as unknown as LlmMessage);
      }
      throw new ValidationError(
        "The assistant reached its tool-call budget. Try a narrower question.",
      );
    } finally {
      await deps.db.chatConversation.updateMany({
        where: { ...scope(c), id: conversation.id, lockedUntil: lease },
        data: { messages: JSON.stringify(messages), lockedUntil: 0 },
      });
    }
  });
  return router;
}
