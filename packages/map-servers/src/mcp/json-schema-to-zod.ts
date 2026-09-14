import { z, type ZodSchema } from "zod";

/**
 * Best-effort JSON Schema → Zod translation for an MCP tool's `inputSchema`. Not a general
 * JSON Schema compiler — it covers the shapes real MCP tools overwhelmingly use (an object
 * of string/number/integer/boolean/array/enum properties, nested one level), and falls back
 * to `z.unknown()` for anything it doesn't recognize (oneOf/anyOf/allOf, `$ref`, tuple-style
 * arrays, …) rather than guessing wrong.
 *
 * This is a deliberate, disclosed gap against ARCHITECTURE.md §4's "every action is
 * validated against a Zod schema" for the shapes it can't translate: those fields still
 * pass through this capability's `inputSchema`/`outputSchema` untyped, but the real MCP
 * server remains the source of truth for its own tool's arguments and rejects (via
 * `isError`) anything invalid — the same trust boundary as calling out to any other real
 * external system this platform doesn't control the schema of.
 */
export function jsonSchemaToZod(schema: Record<string, unknown> | undefined | null): ZodSchema {
  if (!schema || typeof schema !== "object") return z.unknown();
  return convert(schema);
}

function convert(schema: Record<string, unknown>): ZodSchema {
  if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === "string")) {
    const values = schema.enum as string[];
    return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.unknown();
  }

  switch (schema.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array": {
      const items = schema.items;
      const itemSchema =
        items && typeof items === "object" && !Array.isArray(items)
          ? convert(items as Record<string, unknown>)
          : z.unknown();
      return z.array(itemSchema);
    }
    case "object":
      return convertObject(schema);
    default:
      // No `type` at all (common for a loosely-specified tool) — if it looks like an
      // object schema (has `properties`), treat it as one; otherwise give up honestly.
      return typeof schema.properties === "object" && schema.properties !== null
        ? convertObject(schema)
        : z.unknown();
  }
}

function convertObject(schema: Record<string, unknown>): ZodSchema {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    return z.record(z.unknown());
  }
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const shape: Record<string, ZodSchema> = {};
  for (const [key, propSchema] of Object.entries(properties as Record<string, unknown>)) {
    const zodProp = convert((propSchema ?? {}) as Record<string, unknown>);
    shape[key] = required.has(key) ? zodProp : zodProp.optional();
  }
  return z.object(shape).passthrough();
}
