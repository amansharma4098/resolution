import { describe, expect, it } from "vitest";
import type { ResolutionMode } from "@resolution/shared";
import { DEFAULT_POLICY, evaluatePolicy, resolutionModeCeiling, stricterBehavior } from "../policy-engine";

describe("resolutionModeCeiling", () => {
  it("maps each resolution mode to its ceiling behavior", () => {
    expect(resolutionModeCeiling("OBSERVE_ONLY")).toBe("DENY");
    expect(resolutionModeCeiling("RECOMMEND")).toBe("APPROVAL");
    expect(resolutionModeCeiling("HUMAN_APPROVED")).toBe("APPROVAL");
    expect(resolutionModeCeiling("AUTONOMOUS")).toBe("AUTO");
  });
});

describe("stricterBehavior", () => {
  it("returns the less permissive of the two", () => {
    expect(stricterBehavior("AUTO", "APPROVAL")).toBe("APPROVAL");
    expect(stricterBehavior("DENY", "AUTO")).toBe("DENY");
    expect(stricterBehavior("APPROVAL", "APPROVAL")).toBe("APPROVAL");
  });
});

describe("evaluatePolicy", () => {
  it("an AUTO policy only actually runs AUTO once the org is AUTONOMOUS", () => {
    const policy = { behavior: "AUTO" as const, resolutionModeFloor: "RECOMMEND" as const };
    expect(evaluatePolicy("RECOMMEND", policy)).toBe("APPROVAL"); // capped by ceiling
    expect(evaluatePolicy("HUMAN_APPROVED", policy)).toBe("APPROVAL"); // capped by ceiling
    expect(evaluatePolicy("AUTONOMOUS", policy)).toBe("AUTO"); // ceiling lifts
  });

  it("OBSERVE_ONLY denies every capability regardless of its configured policy", () => {
    const autoPolicy = { behavior: "AUTO" as const, resolutionModeFloor: "OBSERVE_ONLY" as const };
    expect(evaluatePolicy("OBSERVE_ONLY", autoPolicy)).toBe("DENY");
  });

  it("a resolutionModeFloor above the org's current mode denies, not falls back to a weaker behavior", () => {
    const policy = { behavior: "AUTO" as const, resolutionModeFloor: "AUTONOMOUS" as const };
    expect(evaluatePolicy("HUMAN_APPROVED", policy)).toBe("DENY");
    expect(evaluatePolicy("AUTONOMOUS", policy)).toBe("AUTO");
  });

  it("a DENY policy is always denied, even in AUTONOMOUS mode", () => {
    const policy = { behavior: "DENY" as const, resolutionModeFloor: "OBSERVE_ONLY" as const };
    expect(evaluatePolicy("AUTONOMOUS", policy)).toBe("DENY");
  });

  it("with no explicit policy row, defaults to APPROVAL once eligible and DENY below it", () => {
    expect(evaluatePolicy("OBSERVE_ONLY")).toBe("DENY");
    expect(evaluatePolicy("RECOMMEND")).toBe("APPROVAL");
    expect(evaluatePolicy("AUTONOMOUS")).toBe("APPROVAL"); // default never auto-executes unconfigured
    expect(DEFAULT_POLICY.behavior).toBe("APPROVAL");
  });

  it("every (mode, policy-behavior) combination is covered without throwing", () => {
    const modes: ResolutionMode[] = ["OBSERVE_ONLY", "RECOMMEND", "HUMAN_APPROVED", "AUTONOMOUS"];
    const behaviors = ["AUTO", "APPROVAL", "DENY"] as const;
    for (const mode of modes) {
      for (const behavior of behaviors) {
        for (const floor of modes) {
          expect(() => evaluatePolicy(mode, { behavior, resolutionModeFloor: floor })).not.toThrow();
        }
      }
    }
  });
});
