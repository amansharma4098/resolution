import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mcp(app: Hono<AppEnv>, apiKey: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await app.request("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("MCP server (POST /api/mcp)", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let organizationId: string;
  let apiKey: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
    const created = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Claude Desktop" } });
    apiKey = (await jsonOf(created)).token;
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a revoked or bogus API key", async () => {
    const { status } = await mcp(app, "rsk_not_a_real_key", { method: "tools/list" });
    expect(status).toBe(401);
  });

  it("responds to initialize", async () => {
    const { status, body } = await mcp(app, apiKey, { method: "initialize", params: {} });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("resolution");
  });

  it("lists exactly the three read-only tools", async () => {
    const { body } = await mcp(app, apiKey, { method: "tools/list" });
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["get_incident", "get_rca", "list_incidents"]);
    expect(body.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(
      true,
    );
  });

  it("unknown method is a JSON-RPC error", async () => {
    const { body } = await mcp(app, apiKey, { method: "not/a/real/method" });
    expect(body.error.code).toBe(-32601);
  });

  it("list_incidents returns an (empty) list for an org the caller belongs to", async () => {
    const { status, body } = await mcp(app, apiKey, {
      method: "tools/call",
      params: { name: "list_incidents", arguments: { organizationId } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    const incidents = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(incidents)).toBe(true);
  });

  it("list_incidents on an organization the caller doesn't belong to reports not found, not forbidden", async () => {
    const other = await signupWithOrg(app, "other@example.com", "Other Org");
    const { body } = await mcp(app, apiKey, {
      method: "tools/call",
      params: { name: "list_incidents", arguments: { organizationId: other.organizationId } },
    });
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0].text).error).toMatch(/not found/i);
  });

  it("get_incident 404s (as a tool error) for a nonexistent incident", async () => {
    const { body } = await mcp(app, apiKey, {
      method: "tools/call",
      params: { name: "get_incident", arguments: { organizationId, incidentId: "nonexistent" } },
    });
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0].text).error).toMatch(/not found/i);
  });

  it("get_rca reports no RCA yet for an incident that hasn't been investigated", async () => {
    // Directly seed an incident via the fake db through the webhook path isn't needed here —
    // there's no incident at all, so get_incident's not-found path is what actually fires;
    // this just documents get_rca's own tool exists and is reachable/dispatchable.
    const { body } = await mcp(app, apiKey, {
      method: "tools/call",
      params: { name: "get_rca", arguments: { organizationId, incidentId: "nonexistent" } },
    });
    expect(body.result.isError).toBe(true);
  });

  it("an unknown tool name is a tool-level error, not a JSON-RPC protocol error", async () => {
    const { body } = await mcp(app, apiKey, {
      method: "tools/call",
      params: { name: "delete_everything", arguments: {} },
    });
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
  });

  it("a revoked key can no longer authenticate", async () => {
    const created = await req(app, "/api/api-keys", { method: "POST", cookie, body: { name: "Short-lived" } });
    const { token, apiKey: created_ } = await jsonOf(created);
    await req(app, `/api/api-keys/${created_.id}`, { method: "DELETE", cookie });

    const { status } = await mcp(app, token, { method: "tools/list" });
    expect(status).toBe(401);
  });
});
