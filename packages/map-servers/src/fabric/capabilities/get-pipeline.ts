import { z } from "zod";
import type { Capability } from "../../types";
import { fabricClientFromContext } from "../context";

const InputSchema = z.object({ workspaceId: z.string().min(1), pipelineId: z.string().min(1) });
const OutputSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.string(),
  workspaceId: z.string(),
});

// `satisfies`, not an explicit `: Capability<In, Out>` annotation — see get-workspace.ts's
// comment for why.
export const getPipelineCapability = {
  key: "get_pipeline",
  description: "Fetch metadata for a Fabric data pipeline item",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = await fabricClientFromContext(ctx);
    return client.getPipeline(input.workspaceId, input.pipelineId);
  },
} satisfies Capability<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>>;
