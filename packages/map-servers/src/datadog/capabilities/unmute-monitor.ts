import { z } from "zod";
import type { Capability } from "../../types";
import { datadogClientFromContext } from "../context";

const InputSchema = z.object({ monitorId: z.number().int() });
const OutputSchema = z.object({ monitorId: z.number(), silenced: z.boolean() });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const unmuteMonitorCapability = {
  key: "unmute_monitor",
  description: "Restore normal alerting on a previously muted Datadog monitor",
  // LOW, not MEDIUM like mute_monitor — this restores normal alerting rather than
  // suppressing it, so the failure mode of a wrong call is "an extra page," not a missed one.
  riskLevel: "LOW",
  mutating: true,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = datadogClientFromContext(ctx);
    const monitor = await client.unmuteMonitor(input.monitorId);
    return { monitorId: monitor.id, silenced: Object.keys(monitor.options.silenced ?? {}).length > 0 };
  },
  verification: {
    capabilityKey: "get_monitor",
    buildInput: (input: Input) => ({ monitorId: input.monitorId }),
    classify: (verifyOutput: unknown) => {
      const silenced = (verifyOutput as { silenced?: boolean }).silenced;
      return silenced === false ? "PASSED" : "FAILED";
    },
  },
} satisfies Capability<Input, Output>;
