import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraApiError, JiraClient } from "../client";

describe("JiraClient", () => {
  const credential = { email: "bot@example.com", apiToken: "tok_123" };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends HTTP Basic auth built from email:apiToken", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accountId: "abc", displayName: "Bot" }), { status: 200 }),
    );
    const client = new JiraClient("https://acme.atlassian.net", credential);
    const me = await client.getMyself();

    expect(me.displayName).toBe("Bot");
    const [, init] = fetchMock.mock.calls[0]!;
    const authHeader = (init.headers as Record<string, string>).Authorization;
    expect(authHeader).toBe(`Basic ${btoa("bot@example.com:tok_123")}`);
  });

  it("requests the correct URL", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const client = new JiraClient("https://acme.atlassian.net/", credential);
    await client.getIssue("OPS-1");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://acme.atlassian.net/rest/api/3/issue/OPS-1");
  });

  it("throws JiraApiError with the status code on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const client = new JiraClient("https://acme.atlassian.net", credential);
    await expect(client.getMyself()).rejects.toThrow(JiraApiError);
    await expect(client.getMyself()).rejects.toMatchObject({ status: 401 });
  });

  it("wraps a plain-text comment in minimal Atlassian Document Format", async () => {
    // Jira's real API returns the created comment as JSON on 201, not an empty body.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "10001" }), { status: 201 }));
    const client = new JiraClient("https://acme.atlassian.net", credential);
    await client.addComment("OPS-1", "Auto-resolved by the AI agent");

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.body.type).toBe("doc");
    expect(body.body.content[0].content[0].text).toBe("Auto-resolved by the AI agent");
  });
});
