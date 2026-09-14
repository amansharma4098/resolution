import { z } from "zod";
import type { Capability } from "../../types";
import { datadogClientFromContext } from "../context";

const InputSchema = z.object({ monitorId: z.number().int() });
const OutputSchema = z.object({
  id: z.number(),
  name: z.string(),
  message: z.string(),
  query: z.string(),
  overallState: z.string(),
  tags: z.array(z.string()),
  silenced: z.boolean(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const getMonitorCapability = {
  key: "get_monitor",
  description: "Fetch a Datadog monitor's current state (Alert/Warn/OK/No Data/…), query, and mute status",
  riskLevel: "LOW",
  mutating: false,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = datadogClientFromContext(ctx);
    const monitor = await client.getMonitor(input.monitorId);
    return {
      id: monitor.id,
      name: monitor.name,
      message: monitor.message,
      query: monitor.query,
      overallState: monitor.overall_state,
      tags: monitor.tags,
      silenced: Object.keys(monitor.options.silenced ?? {}).length > 0,
    };
  },
} satisfies Capability<Input, Output>;
