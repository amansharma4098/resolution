import { describe, it, expect } from "vitest";
import { McpConfigSchema } from "../config.schema";
describe("SaaS MCP endpoint configuration", () => {
  it.each([
    "http://mcp.example.com",
    "https://localhost",
    "https://mcp.internal",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://user:secret@example.com",
    "https://mcp.example.com?token=secret",
    "https://mcp.example.com:8443",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(McpConfigSchema.safeParse({ url }).success).toBe(false);
  });
  it("rejects plaintext authorization headers", () => {
    expect(
      McpConfigSchema.safeParse({
        url: "https://mcp.example.com",
        headers: { Authorization: "secret" },
      }).success,
    ).toBe(false);
  });
  it("accepts public HTTPS endpoints", () => {
    expect(McpConfigSchema.safeParse({ url: "https://mcp.example.com/mcp" }).success).toBe(true);
  });
});
