import { z } from "zod";
import type { Capability } from "../../types";
import { datadogClientFromContext } from "../context";

const InputSchema = z.object({ tags: z.string().optional() });
const OutputSchema = z.object({
  monitors: z.array(
    z.object({ id: z.number(), name: z.string(), overallState: z.string(), tags: z.array(z.string()) }),
  ),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const listMonitorsCapability = {
  key: "list_monitors",
  description: "List Datadog monitors, optionally filtered by a comma-separated tag query (e.g. \"service:checkout\")",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = datadogClientFromContext(ctx);
    const monitors = await client.listMonitors(input.tags);
    return {
      monitors: monitors.map((m) => ({ id: m.id, name: m.name, overallState: m.overall_state, tags: m.tags })),
    };
  },
} satisfies Capability<Input, Output>;
