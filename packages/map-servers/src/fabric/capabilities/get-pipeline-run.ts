import { z } from "zod";
import type { Capability } from "../../types";
import { fabricClientFromContext } from "../context";

const InputSchema = z.object({
  workspaceId: z.string().min(1),
  pipelineId: z.string().min(1),
  jobInstanceId: z.string().min(1),
});
const OutputSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  jobType: z.string(),
  status: z.string(),
  startTimeUtc: z.string().optional(),
  endTimeUtc: z.string().optional(),
  failureReason: z.object({ errorCode: z.string().optional(), message: z.string().optional() }).nullable().optional(),
});

// `satisfies`, not an explicit `: Capability<In, Out>` annotation — see get-workspace.ts's
// comment for why.
export const getPipelineRunCapability = {
  key: "get_pipeline_run",
  description: "Fetch the status and result of a specific Fabric pipeline run",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = await fabricClientFromContext(ctx);
    return client.getPipelineRun(input.workspaceId, input.pipelineId, input.jobInstanceId);
  },
} satisfies Capability<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>>;
