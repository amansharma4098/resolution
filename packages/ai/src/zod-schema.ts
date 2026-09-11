import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodSchema } from "zod";

/**
 * Converts a Zod schema (a Map Server capability's `inputSchema`, or the platform's own
 * `RootCauseAnalysisOutput`) into the plain JSON-schema object Anthropic's `tool.input_schema`
 * expects. `zod-to-json-schema` emits a JSON-Schema *document* by default (a `$schema` key
 * and, for recursive schemas, a `definitions`/`$ref` wrapper) — we strip the `$schema` key
 * since Anthropic's tool schema is just the bare object schema, not a standalone document.
 *
 * We do not additionally set `strict: true` on tool definitions built from this — capability
 * schemas are written independently per Map Server provider and may use Zod features (e.g.
 * `.uuid()`/`.email()` string formats) that strict mode's schema-compatibility subset can
 * reject. Tool inputs are still validated for real, just server-side with the original Zod
 * schema after the model calls the tool (see packages/agents' investigation-agent.ts) rather
 * than API-side — the same amount of validation, applied at the point we can give the model a
 * precise, schema-specific error to retry against.
 */
export function zodToToolSchema(schema: ZodSchema): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
