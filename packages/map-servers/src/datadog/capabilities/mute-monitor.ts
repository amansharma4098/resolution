import { z } from "zod";
import type { Capability } from "../../types";
import { datadogClientFromContext } from "../context";

const InputSchema = z.object({
  monitorId: z.number().int(),
  endUnixSeconds: z.number().int().optional().describe("Unix timestamp to auto-unmute at; omit to mute indefinitely"),
});
const OutputSchema = z.object({ monitorId: z.number(), silenced: z.boolean() });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

/**
 * The one mutating capability on this provider — riskLevel MEDIUM (silences real alerting,
 * so a wrong call has a real cost: someone might miss a genuine subsequent page), gated by
 * AutomationPolicy same as every other mutating capability. A realistic remediation for a
 * noisy/flapping monitor during a known, already-being-fixed issue — never invoked directly
 * by user action; Phase 8's remediation flow calls capabilities like this one.
 */
export const muteMonitorCapability = {
  key: "mute_monitor",
  description: "Mute a Datadog monitor (optionally until a given time) to silence alert noise during a known issue",
  riskLevel: "MEDIUM",
  mutating: true,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (ctx, input) => {
    const client = datadogClientFromContext(ctx);
    const monitor = await client.muteMonitor(input.monitorId, input.endUnixSeconds ?? null);
    return { monitorId: monitor.id, silenced: Object.keys(monitor.options.silenced ?? {}).length > 0 };
  },
  // Verified by re-reading the monitor and checking its mute state — never "the API returned
  // 200 so it worked" (ARCHITECTURE.md §6).
  verification: {
    capabilityKey: "get_monitor",
    buildInput: (input: Input) => ({ monitorId: input.monitorId }),
    classify: (verifyOutput: unknown) => {
      const silenced = (verifyOutput as { silenced?: boolean }).silenced;
      return silenced === true ? "PASSED" : "FAILED";
    },
  },
} satisfies Capability<Input, Output>;
