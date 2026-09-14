import { z } from "zod";
import type { Capability } from "../../types";
import { datadogClientFromContext } from "../context";

const InputSchema = z.object({
  query: z.string().min(1).describe('Datadog metric query, e.g. "avg:system.cpu.user{host:web-1}"'),
  fromUnixSeconds: z.number().int(),
  toUnixSeconds: z.number().int(),
});
const OutputSchema = z.object({
  series: z.array(z.object({ metric: z.string(), scope: z.string(), pointlist: z.array(z.tuple([z.number(), z.number()])) })),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const queryMetricsCapability = {
  key: "query_metrics",
  description: "Query a Datadog metric time series over a time range — real evidence for an investigation (CPU, latency, error rate, …)",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = datadogClientFromContext(ctx);
    const result = await client.queryMetrics(input.query, input.fromUnixSeconds, input.toUnixSeconds);
    return {
      series: result.series.map((s) => ({ metric: s.metric, scope: s.scope, pointlist: s.pointlist })),
    };
  },
} satisfies Capability<Input, Output>;
