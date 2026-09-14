import { describe, expect, it } from "vitest";
import { createMockChatClient } from "../mock-chat-client";

describe("createMockChatClient", () => {
  it("never calls a tool — reasoning about a free-form message needs a real LLM", async () => {
    const client = createMockChatClient();
    const result = await client.send({
      system: "irrelevant",
      messages: [{ role: "user", content: "list my incidents" }],
      tools: [{ name: "list_incidents", description: "d", input_schema: { type: "object", properties: {} } }],
    });
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolUses).toEqual([]);
  });

  it("is clearly labeled as mock, not disguised as a real answer", async () => {
    const client = createMockChatClient();
    expect(client.isMock).toBe(true);
    const result = await client.send({ system: "x", messages: [], tools: [] });
    const text = result.content[0];
    expect(text).toMatchObject({ type: "text" });
    expect((text as { text: string }).text).toMatch(/MOCK_MODE/);
  });
});
