import type { PolicyBehavior, ResolutionMode } from "@resolution/shared";

/**
 * Pure code, deliberately — ARCHITECTURE.md §6: "LLMs are NEVER used for deterministic
 * business logic (policy evaluation, approval gating, verification checks)". This is the
 * single place that decides whether a proposed remediation action runs automatically, needs
 * human approval, or is denied outright.
 *
 * Two independent inputs combine (ARCHITECTURE.md §7): (a) the AutomationPolicy row an admin
 * configured for this exact (mapServerType, capabilityKey), and (b) what the org's current
 * `resolutionMode` permits at all — effective behavior is always the *stricter* of the two,
 * so a LOW-risk action explicitly configured AUTO still requires approval while the org is
 * in RECOMMEND mode.
 *
 * `resolutionModeFloor` on a policy row is a second, independent gate: the minimum
 * resolutionMode the org must be in before that row's `behavior` is honored at all. Below
 * the floor, the row is treated as absent (DENY) rather than falling back to some other
 * behavior — a floor exists specifically so an admin can say "don't even consider this
 * automatable until we're at least in HUMAN_APPROVED mode", not just "cap it at APPROVAL".
 *
 * Design simplification, stated plainly rather than left implicit: the four-tier
 * `resolutionMode` (OBSERVE_ONLY/RECOMMEND/HUMAN_APPROVED/AUTONOMOUS) collapses to three
 * `PolicyBehavior` ceilings here — RECOMMEND and HUMAN_APPROVED both cap at APPROVAL. The
 * spec's distinction between them (RECOMMEND = "surface a suggestion", HUMAN_APPROVED =
 * "create a real, executable, approval-gated action") is a UI/workflow distinction Phase 8
 * doesn't further separate at the policy-engine layer — both modes produce a real
 * `Resolution` + `RemediationAction` row gated on human approval; a future phase could add a
 * genuinely non-actionable "recommend only, never even propose a capability call" mode if
 * that distinction turns out to matter in practice.
 */

const BEHAVIOR_STRICTNESS: Record<PolicyBehavior, number> = { DENY: 0, APPROVAL: 1, AUTO: 2 };
const MODE_ORDER: Record<ResolutionMode, number> = {
  OBSERVE_ONLY: 0,
  RECOMMEND: 1,
  HUMAN_APPROVED: 2,
  AUTONOMOUS: 3,
};

export function resolutionModeCeiling(mode: ResolutionMode): PolicyBehavior {
  switch (mode) {
    case "OBSERVE_ONLY":
      return "DENY";
    case "RECOMMEND":
    case "HUMAN_APPROVED":
      return "APPROVAL";
    case "AUTONOMOUS":
      return "AUTO";
  }
}

/** The stricter (less permissive) of two behaviors. */
export function stricterBehavior(a: PolicyBehavior, b: PolicyBehavior): PolicyBehavior {
  return BEHAVIOR_STRICTNESS[a] <= BEHAVIOR_STRICTNESS[b] ? a : b;
}

export interface PolicyRow {
  behavior: PolicyBehavior;
  resolutionModeFloor: ResolutionMode;
}

/** No explicit AutomationPolicy row for a (mapServerType, capabilityKey) — safe-by-default:
 *  requires approval, and only once the org is at least in RECOMMEND mode (never AUTO,
 *  never usable at all in OBSERVE_ONLY) until an admin configures something more specific. */
export const DEFAULT_POLICY: PolicyRow = { behavior: "APPROVAL", resolutionModeFloor: "RECOMMEND" };

export function evaluatePolicy(orgResolutionMode: ResolutionMode, policy?: PolicyRow): PolicyBehavior {
  const effective = policy ?? DEFAULT_POLICY;
  if (MODE_ORDER[orgResolutionMode] < MODE_ORDER[effective.resolutionModeFloor]) {
    return "DENY";
  }
  return stricterBehavior(effective.behavior, resolutionModeCeiling(orgResolutionMode));
}
