import { getMapServerProvider } from "@resolution/map-servers";
import type { MapServerContext, MapServerType } from "@resolution/map-servers";
import type { VerificationStatus } from "@resolution/shared";

export interface VerificationRunResult {
  status: VerificationStatus;
  /** What we checked and how — not a literal "expected value", since `classify()` is a
   *  black box the verification spec owns (ARCHITECTURE.md §6's Verification Agent is
   *  plain code, but *what* success looks like is provider-specific domain knowledge). */
  expectedState: unknown;
  actualState: unknown;
}

/**
 * Re-checks a mutating capability's real-world effect by calling its declared
 * `verification` companion (packages/map-servers/src/types.ts's `VerificationSpec`) — never
 * an LLM, never "it returned 200 so it worked" (ARCHITECTURE.md §6). Returns `null` when
 * there is nothing to check: no `verification` declared on the capability, the companion
 * capability doesn't actually exist on the provider, or the built input doesn't validate —
 * every one of those is a provider-configuration gap, not a runtime failure, so the caller
 * (apps/api's remediation consumer) treats `null` as "executed, but not automatically
 * verifiable" rather than a verification failure.
 */
export async function runVerification(params: {
  mapServerType: MapServerType;
  mapServerId: string;
  capabilityKey: string; // the mutating capability that was executed
  mutatingInput: unknown;
  mutatingOutput: unknown;
  contextFor: (mapServerId: string) => Promise<MapServerContext>;
}): Promise<VerificationRunResult | null> {
  const provider = getMapServerProvider(params.mapServerType);
  const mutatingCapability = provider?.capabilities.find((c) => c.key === params.capabilityKey);
  const spec = mutatingCapability?.verification;
  if (!provider || !mutatingCapability || !spec) return null;

  const verifyCapability = provider.capabilities.find((c) => c.key === spec.capabilityKey);
  if (!verifyCapability) return null;

  const verifyInputParsed = verifyCapability.inputSchema.safeParse(
    spec.buildInput(params.mutatingInput, params.mutatingOutput),
  );
  if (!verifyInputParsed.success) return null;

  const ctx = await params.contextFor(params.mapServerId);
  const actualState = await verifyCapability.execute(ctx, verifyInputParsed.data);

  return {
    status: spec.classify(actualState),
    expectedState: { checkedVia: spec.capabilityKey, input: verifyInputParsed.data },
    actualState,
  };
}
