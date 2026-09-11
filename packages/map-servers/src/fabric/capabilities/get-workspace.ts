import { z } from "zod";
import type { Capability } from "../../types";
import { fabricClientFromContext } from "../context";

const InputSchema = z.object({ workspaceId: z.string().min(1) });
const OutputSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  type: z.string(),
});

// `satisfies` (not a `: Capability<In, Out>` annotation) — an explicit generic annotation
// here makes TS check this value against the *contravariant* function-parameter position
// of Capability's `execute`, which breaks assigning a strongly-typed Capability into the
// provider's heterogeneous `Capability[]` array (packages/map-servers/src/fabric/index.ts).
// `satisfies` validates the shape while preserving the literal/inferred type instead.
export const getWorkspaceCapability = {
  key: "get_workspace",
  description: "Fetch metadata for a Fabric workspace",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = await fabricClientFromContext(ctx);
    return client.getWorkspace(input.workspaceId);
  },
} satisfies Capability<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>>;
