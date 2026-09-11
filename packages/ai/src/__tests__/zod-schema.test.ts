import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToToolSchema } from "../zod-schema";

describe("zodToToolSchema", () => {
  it("converts a Zod object schema into a bare JSON-schema object, not a document", () => {
    const schema = z.object({
      workspaceId: z.string().min(1),
      pipelineId: z.string().min(1),
      limit: z.number().optional(),
    });

    const json = zodToToolSchema(schema);

    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect(json.required).toEqual(expect.arrayContaining(["workspaceId", "pipelineId"]));
    expect(json.required).not.toEqual(expect.arrayContaining(["limit"]));
    const properties = json.properties as Record<string, unknown>;
    expect(properties.workspaceId).toMatchObject({ type: "string" });
  });

  it("carries enum values through as a JSON-schema enum", () => {
    const schema = z.object({ claimType: z.enum(["FACT", "INFERENCE", "HYPOTHESIS"]) });
    const json = zodToToolSchema(schema);
    const properties = json.properties as Record<string, { enum?: string[] }>;
    expect(properties.claimType?.enum).toEqual(["FACT", "INFERENCE", "HYPOTHESIS"]);
  });
});
