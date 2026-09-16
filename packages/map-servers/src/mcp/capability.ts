import { redactMcpResult } from "./redact";
import { McpConfigSchema } from "./config.schema";
import { z } from "zod";
import type { AnyCapability } from "../types";
import { mcpClientFromContext } from "./context";
import { jsonSchemaToZod } from "./json-schema-to-zod";
import type { McpTool } from "./client";

/** Every discovered tool's output goes through this shape — MCP's `tools/call` result is
 *  always a list of content blocks (text, or a resource reference), regardless of the
 *  tool's own domain. A failed call (`isError: true`) throws instead of returning this, so
 *  every other Map Server's convention (execute() throws on failure) holds here too. */
const McpCapabilityOutputSchema = z.object({
  content: z.array(z.record(z.unknown())),
});

/** Tool annotations are untrusted. Only an administrator's matching review grants access. */
export async function mcpToolFingerprint(tool: McpTool): Promise<string> {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(tool))),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function capabilityFromMcpTool(
  tool: McpTool,
  review?: { access: "READ" | "WRITE"; fingerprint: string },
): AnyCapability {
  const readOnly = review?.access === "READ";
  return {
    key: tool.name,
    description: tool.description ?? `MCP tool "${tool.name}"`,
    riskLevel: readOnly ? "LOW" : "HIGH",
    mutating: !readOnly,
    inputSchema: jsonSchemaToZod(tool.inputSchema),
    outputSchema: McpCapabilityOutputSchema,
    execute: async (ctx, input) => {
      const config = McpConfigSchema.parse(ctx.config);
      const current = config.toolReviews[tool.name];
      if (
        !current ||
        (review && current.access !== review.access) ||
        current.fingerprint !== (await mcpToolFingerprint(tool))
      ) {
        throw new Error("MCP tool requires administrator review before execution");
      }
      const client = mcpClientFromContext(ctx);
      const live = (await client.listTools()).find((entry) => entry.name === tool.name);
      if (!live || (await mcpToolFingerprint(live)) !== current.fingerprint) {
        throw new Error("MCP tool changed; refresh and review its permissions before execution");
      }
      const result = redactMcpResult(await client.callTool(tool.name, input), ctx.credential);
      if (result.isError) {
        const message = result.content
          .map((block) => (typeof block.text === "string" ? block.text : JSON.stringify(block)))
          .join("; ");
        throw new Error(`MCP tool "${tool.name}" failed: ${message || "no error detail returned"}`);
      }
      return result;
    },
  };
}
