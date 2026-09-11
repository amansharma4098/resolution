import { describe, expect, it } from "vitest";
import { canTransition, IllegalTransitionError, isTerminal, transition } from "../incident-state-machine";
import type { IncidentStatus } from "@resolution/shared";

const ALL_STATUSES: IncidentStatus[] = [
  "NEW",
  "INVESTIGATING",
  "RCA_COMPLETE",
  "PENDING_APPROVAL",
  "REMEDIATING",
  "VERIFYING",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
  "FAILED",
];

describe("incident state machine", () => {
  it("allows the happy path: NEW -> INVESTIGATING -> RCA_COMPLETE -> PENDING_APPROVAL -> REMEDIATING -> VERIFYING -> RESOLVED -> CLOSED", () => {
    const path: IncidentStatus[] = [
      "NEW",
      "INVESTIGATING",
      "RCA_COMPLETE",
      "PENDING_APPROVAL",
      "REMEDIATING",
      "VERIFYING",
      "RESOLVED",
      "CLOSED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
      expect(transition(path[i]!, path[i + 1]!)).toBe(path[i + 1]);
    }
  });

  it("allows the AUTO-policy fast path: RCA_COMPLETE straight to REMEDIATING (no approval needed)", () => {
    expect(canTransition("RCA_COMPLETE", "REMEDIATING")).toBe(true);
  });

  it("allows a failed verification to retry remediation", () => {
    expect(canTransition("VERIFYING", "REMEDIATING")).toBe(true);
  });

  it("rejects skipping straight from NEW to RESOLVED", () => {
    expect(canTransition("NEW", "RESOLVED")).toBe(false);
    expect(() => transition("NEW", "RESOLVED")).toThrow(IllegalTransitionError);
  });

  it("rejects any transition out of CLOSED — it's terminal", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition("CLOSED", status)).toBe(false);
    }
    expect(isTerminal("CLOSED")).toBe(true);
  });

  it("RESOLVED is not fully terminal — it can still move to CLOSED", () => {
    expect(isTerminal("RESOLVED")).toBe(false);
    expect(canTransition("RESOLVED", "CLOSED")).toBe(true);
  });

  it("ESCALATED and FAILED can both hand back to INVESTIGATING or end at CLOSED", () => {
    expect(canTransition("ESCALATED", "INVESTIGATING")).toBe(true);
    expect(canTransition("ESCALATED", "CLOSED")).toBe(true);
    expect(canTransition("FAILED", "INVESTIGATING")).toBe(true);
    expect(canTransition("FAILED", "CLOSED")).toBe(true);
  });

  it("the error carries the attempted from/to for logging", () => {
    try {
      transition("CLOSED", "NEW");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      expect((err as IllegalTransitionError).from).toBe("CLOSED");
      expect((err as IllegalTransitionError).to).toBe("NEW");
    }
  });

  it("every status is reachable and has at least one outgoing transition except CLOSED", () => {
    for (const status of ALL_STATUSES) {
      if (status === "CLOSED") continue;
      expect(isTerminal(status)).toBe(false);
    }
  });
});
