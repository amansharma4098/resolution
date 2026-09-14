import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "../json-schema-to-zod";

describe("jsonSchemaToZod", () => {
  it("converts a simple object schema with required and optional fields", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        id: { type: "string" },
        count: { type: "integer" },
        active: { type: "boolean" },
      },
      required: ["id"],
    });

    expect(schema.parse({ id: "x", count: 3, active: true })).toEqual({ id: "x", count: 3, active: true });
    expect(schema.parse({ id: "x" })).toEqual({ id: "x" });
    expect(() => schema.parse({ count: 3 })).toThrow();
  });

  it("converts an array of strings", () => {
    const schema = jsonSchemaToZod({ type: "array", items: { type: "string" } });
    expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => schema.parse([1, 2])).toThrow();
  });

  it("converts a string enum", () => {
    const schema = jsonSchemaToZod({ type: "string", enum: ["LOW", "HIGH"] });
    expect(schema.parse("LOW")).toBe("LOW");
    expect(() => schema.parse("MEDIUM")).toThrow();
  });

  it("converts nested objects one level deep", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: { status: { type: "string" } },
          required: ["status"],
        },
      },
      required: ["filter"],
    });
    expect(schema.parse({ filter: { status: "open" } })).toEqual({ filter: { status: "open" } });
  });

  it("falls back to permissive unknown for constructs it doesn't translate", () => {
    const schema = jsonSchemaToZod({ oneOf: [{ type: "string" }, { type: "number" }] });
    expect(schema.parse("anything")).toBe("anything");
    expect(schema.parse(42)).toBe(42);
  });

  it("falls back to unknown for a missing/undefined schema", () => {
    expect(jsonSchemaToZod(undefined).parse("anything")).toBe("anything");
    expect(jsonSchemaToZod(null).parse(123)).toBe(123);
  });

  it("infers an object schema from `properties` even with no explicit `type`", () => {
    const schema = jsonSchemaToZod({ properties: { name: { type: "string" } }, required: ["name"] });
    expect(schema.parse({ name: "x" })).toEqual({ name: "x" });
  });

  it("allows extra properties on an object schema (passthrough)", () => {
    const schema = jsonSchemaToZod({ type: "object", properties: { id: { type: "string" } } });
    expect(schema.parse({ id: "x", extra: "field" })).toEqual({ id: "x", extra: "field" });
  });
});
