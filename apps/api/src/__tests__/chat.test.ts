import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { LlmTurnResult } from "@resolution/ai";
import { buildTestApp, createScriptedLlmClient, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

function textTurn(text: string): LlmTurnResult {
  return { stopReason: "end_turn", content: [{ type: "text", text, citations: [] }], toolUses: [] };
}

function toolUseTurn(name: string, input: Record<string, unknown>, id = `tu_${name}`): LlmTurnResult {
  const block = { type: "tool_use" as const, id, name, input, caller: { type: "direct" as const } };
  return { stopReason: "tool_use", content: [block], toolUses: [block] };
}

describe("chat (POST /api/chat)", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("requires an X-Tenant-Id header, like every other tenant-scoped route", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(404);
  });

  it("with MOCK_MODE's default chat client, responds with an honest MOCK_MODE explanation and calls no tools", async () => {
    const res = await req(app, "/api/chat", {
      method: "POST",
      cookie,
      tenantId,
      body: { messages: [{ role: "user", content: "list my incidents" }] },
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.isMock).toBe(true);
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(JSON.stringify(last.content)).toMatch(/MOCK_MODE/);
  });

  it("a scripted single-tool-call turn: calls list_incidents, injecting the real tenantId, then answers", async () => {
    const llmClient = createScriptedLlmClient([
      toolUseTurn("list_incidents", { tenantId: "not-the-real-one" }),
      textTurn("You have no incidents yet."),
    ]);
    const { app: scriptedApp } = await buildTestApp({ chatLlmClient: llmClient });
    const signup = await signupWithOrg(scriptedApp, "owner2@example.com", "Acme2");

    const res = await req(scriptedApp, "/api/chat", {
      method: "POST",
      cookie: signup.cookie,
      tenantId: signup.tenantId,
      body: { messages: [{ role: "user", content: "what incidents do we have?" }] },
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const lastText = JSON.stringify(body.messages[body.messages.length - 1].content);
    expect(lastText).toMatch(/no incidents yet/);

    // The tool_result the second call received proves the server, not the model, decided
    // which tenantId was actually queried (it ignored "not-the-real-one").
    const secondCallMessages = llmClient.calls[1]!.messages as Array<{ content: unknown }>;
    const toolResultContent = JSON.stringify(secondCallMessages[secondCallMessages.length - 1]!.content);
    expect(toolResultContent).not.toMatch(/not-the-real-one/);
  });

  it("decide_approval still enforces ADMIN — a MEMBER's chat session gets a tool error, not a silent success", async () => {
    const llmClient = createScriptedLlmClient([
      toolUseTurn("decide_approval", { incidentId: "x", approvalId: "y", decision: "APPROVE" }),
      textTurn("I wasn't able to approve that."),
    ]);
    const { app: scriptedApp } = await buildTestApp({ chatLlmClient: llmClient });
    const owner = await signupWithOrg(scriptedApp, "owner4@example.com", "Acme4");
    const added = await req(scriptedApp, "/api/organizations/members", {
      method: "POST",
      cookie: owner.cookie,
      tenantId: owner.tenantId,
      body: { email: "member4@example.com", role: "MEMBER" },
    });
    const { temporaryPassword } = await jsonOf(added);
    const memberLogin = await req(scriptedApp, "/api/auth/login", {
      method: "POST",
      body: { email: "member4@example.com", password: temporaryPassword },
    });
    const memberCookie = memberLogin.headers.get("set-cookie")!.split(";")[0]!;

    const res = await req(scriptedApp, "/api/chat", {
      method: "POST",
      cookie: memberCookie,
      tenantId: owner.tenantId,
      body: { messages: [{ role: "user", content: "approve it" }] },
    });
    expect(res.status).toBe(200);

    // What the model actually saw back from the tool call — proves the ADMIN check ran
    // server-side and produced a tool-level error, not a silent no-op or a crash.
    const secondCallMessages = llmClient.calls[1]!.messages as Array<{ content: unknown }>;
    const toolResultContent = JSON.stringify(secondCallMessages[secondCallMessages.length - 1]!.content);
    expect(toolResultContent).toMatch(/ADMIN/);
  });

  it("propagates the assistant's tool sequence back in `messages`, ready to be replayed as the next turn's history", async () => {
    const llmClient = createScriptedLlmClient([
      toolUseTurn("list_incidents", {}),
      textTurn("All clear."),
    ]);
    const { app: scriptedApp } = await buildTestApp({ chatLlmClient: llmClient });
    const signup = await signupWithOrg(scriptedApp, "owner5@example.com", "Acme5");
    const res = await req(scriptedApp, "/api/chat", {
      method: "POST",
      cookie: signup.cookie,
      tenantId: signup.tenantId,
      body: { messages: [{ role: "user", content: "any incidents?" }] },
    });
    const body = await jsonOf(res);
    const roles = body.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("gives up gracefully once the tool-call budget is exhausted, rather than looping forever", async () => {
    const turns = Array.from({ length: 11 }, () => toolUseTurn("list_incidents", {}));
    const llmClient = createScriptedLlmClient(turns);
    const { app: scriptedApp } = await buildTestApp({ chatLlmClient: llmClient });
    const signup = await signupWithOrg(scriptedApp, "owner6@example.com", "Acme6");
    const res = await req(scriptedApp, "/api/chat", {
      method: "POST",
      cookie: signup.cookie,
      tenantId: signup.tenantId,
      body: { messages: [{ role: "user", content: "loop forever" }] },
    });
    expect(res.status).toBe(400);
  });
});
