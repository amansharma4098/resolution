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

/**
 * Wraps one MCP tool as a `Capability` — the bridge between "whatever tools this org's MCP
 * server happens to expose" and this platform's typed-capability contract
 * (ARCHITECTURE.md §4). `riskLevel`/`mutating` can't be known for certain — MCP's own spec
 * is explicit that a tool's `readOnlyHint` annotation is a hint, not a guarantee, and warns
 * clients not to make security-critical decisions on it alone. This package still uses it,
 * but only to relax the default, never to tighten it: `readOnlyHint: true` gets `LOW`/
 * `mutating: false` (eligible to run during read-only investigation); everything else —
 * including a server that sends no annotations at all — defaults to the conservative `HIGH`/
 * `mutating: true`, so it's automation-policy-gated and never runs unattended until an org
 * explicitly reviews and enables it (same "nothing runs until explicitly enabled" discipline
 * as every other provider, ARCHITECTURE.md §4/§7).
 */
export function capabilityFromMcpTool(tool: McpTool): AnyCapability {
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    key: tool.name,
    description: tool.description ?? `MCP tool "${tool.name}"`,
    riskLevel: readOnly ? "LOW" : "HIGH",
    mutating: !readOnly,
    inputSchema: jsonSchemaToZod(tool.inputSchema),
    outputSchema: McpCapabilityOutputSchema,
    execute: async (ctx, input) => {
      const client = mcpClientFromContext(ctx);
      const result = await client.callTool(tool.name, input);
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
