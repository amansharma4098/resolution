import { z } from "zod";
import type { Capability } from "../../types";
import { datadogClientFromContext } from "../context";

const InputSchema = z.object({
  query: z.string().min(1),
  from: z.string().min(1).describe('ISO-8601 or Datadog relative time, e.g. "now-15m"'),
  to: z.string().min(1).describe('ISO-8601 or Datadog relative time, e.g. "now"'),
  limit: z.number().int().positive().max(1000).optional(),
});
const OutputSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      message: z.string(),
      status: z.string(),
      service: z.string().nullable(),
      host: z.string().nullable(),
    }),
  ),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const searchLogsCapability = {
  key: "search_logs",
  description: "Search Datadog logs with a query and time range — real evidence for an investigation",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = datadogClientFromContext(ctx);
    const result = await client.searchLogs(input.query, input.from, input.to, input.limit ?? 50);
    return { events: result.data };
  },
} satisfies Capability<Input, Output>;
