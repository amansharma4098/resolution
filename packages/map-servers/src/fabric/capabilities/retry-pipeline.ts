import { z } from "zod";
import type { Capability } from "../../types";
import { fabricClientFromContext } from "../context";

const InputSchema = z.object({ workspaceId: z.string().min(1), pipelineId: z.string().min(1) });
const OutputSchema = z.object({ jobInstanceId: z.string().nullable() });

/**
 * The one mutating Fabric capability — riskLevel LOW per the spec's risk table (§5:
 * "Retry pipeline / Retry Databricks job | LOW | AUTO"), so it defaults to AUTO under the
 * policy engine, overridable per org. Starts a *new* pipeline run (Fabric's Job Scheduler
 * API has no "rerun this exact failed instance" endpoint) — never invoked directly by user
 * action in this phase; Phase 8's remediation flow is what calls capabilities like this
 * one, gated by the policy engine.
 *
 * `satisfies`, not an explicit `: Capability<In, Out>` annotation — see get-workspace.ts's
 * comment for why.
 */
type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const retryPipelineCapability = {
  key: "retry_pipeline",
  description: "Start a new run of a Fabric data pipeline",
  riskLevel: "LOW",
  mutating: true,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = await fabricClientFromContext(ctx);
    return client.retryPipeline(input.workspaceId, input.pipelineId);
  },
  // Fabric's Job Scheduler API is async — starting a run only returns a jobInstanceId, not
  // a result, so verification means polling get_pipeline_run with that id (combined with
  // the workspaceId/pipelineId the retry was called with) until Fabric reports a terminal
  // status. Real Fabric statuses: NotStarted/InProgress (still running), Completed
  // (success), Failed/Cancelled/Deduped (no point retrying).
  verification: {
    capabilityKey: "get_pipeline_run",
    buildInput: (input: Input, output: Output) => ({
      workspaceId: input.workspaceId,
      pipelineId: input.pipelineId,
      jobInstanceId: output.jobInstanceId,
    }),
    classify: (verifyOutput: unknown) => {
      const status = (verifyOutput as { status?: string }).status;
      if (status === "Completed") return "PASSED";
      if (status === "Failed" || status === "Cancelled" || status === "Deduped") return "FAILED";
      return "RETRYING";
    },
  },
} satisfies Capability<Input, Output>;
