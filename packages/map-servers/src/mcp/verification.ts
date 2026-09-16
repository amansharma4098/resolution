import { z } from "zod";
import type { VerificationSpec } from "../types";

const path = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/);
export const McpRecoveryRuleSchema = z
  .object({
    tool: z.string().min(1),
    input: z.record(z.unknown()).default({}),
    inputBindings: z.record(path).default({}),
    resultPath: path,
    equals: z.union([z.string(), z.number(), z.boolean()]),
    actionFingerprint: z.string().min(1),
    verifierFingerprint: z.string().min(1),
  })
  .strict();

function readPath(value: unknown, key: string): unknown {
  let current = value;
  for (const segment of key.split(".")) {
    if (
      ["__proto__", "constructor", "prototype"].includes(segment) ||
      !current ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    )
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** A structured value from the read tool is required; prose or HTTP success cannot pass. */
export function mcpRecoverySpec(rule: z.infer<typeof McpRecoveryRuleSchema>): VerificationSpec {
  return {
    capabilityKey: rule.tool,
    buildInput: (actionInput) => {
      const input = { ...rule.input };
      for (const [key, binding] of Object.entries(rule.inputBindings)) {
        const value = readPath(actionInput, binding);
        if (value === undefined)
          throw new Error(`Recovery check is missing action input ${binding}`);
        Object.defineProperty(input, key, { value, enumerable: true, configurable: true });
      }
      return input;
    },
    classify: (output) => {
      const result = output as {
        structuredContent?: unknown;
        content?: Array<{ type?: string; text?: string }>;
      };
      let data = result?.structuredContent;
      if (data === undefined) {
        const blocks = result?.content?.filter((block) => block.type === "text");
        if (blocks?.length !== 1 || !blocks[0]?.text) return "RETRYING";
        try {
          data = JSON.parse(blocks[0].text);
        } catch {
          return "RETRYING";
        }
      }
      return readPath(data, rule.resultPath) === rule.equals ? "PASSED" : "RETRYING";
    },
  };
}
