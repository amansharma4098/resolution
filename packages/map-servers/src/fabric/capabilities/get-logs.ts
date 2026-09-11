import { z } from "zod";
import type { Capability } from "../../types";
import { fabricClientFromContext } from "../context";

const InputSchema = z.object({
  workspaceId: z.string().min(1),
  pipelineId: z.string().min(1),
  jobInstanceId: z.string().min(1),
});
// Fabric's public API has no dedicated log-streaming endpoint — this surfaces the job
// instance's own status/failureReason, the closest real signal available, rather than
// fabricating log lines. See FabricClient.getLogs's comment.
const OutputSchema = z.object({
  status: z.string(),
  failureReason: z.object({ errorCode: z.string().optional(), message: z.string().optional() }).nullable().optional(),
});

// `satisfies`, not an explicit `: Capability<In, Out>` annotation — see get-workspace.ts's
// comment for why.
export const getLogsCapability = {
  key: "get_logs",
  description: "Fetch the failure detail available for a Fabric pipeline run (Fabric has no dedicated log-streaming API)",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = await fabricClientFromContext(ctx);
    const run = await client.getLogs(input.workspaceId, input.pipelineId, input.jobInstanceId);
    return { status: run.status, failureReason: run.failureReason };
  },
} satisfies Capability<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>>;
