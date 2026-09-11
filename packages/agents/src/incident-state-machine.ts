import type { IncidentStatus } from "@resolution/shared";

/**
 * The incident lifecycle's valid transitions — pure code, deliberately. ARCHITECTURE.md §6:
 * "LLMs are NEVER used for deterministic business logic (policy evaluation, approval
 * gating, verification checks)" — state transitions are exactly that kind of logic. An
 * agent (Phase 7+) or a human action (approve/reject, escalate) proposes a transition; this
 * module is the single place that says whether it's actually allowed, independent of who's
 * asking.
 *
 *   NEW ──────────────┬─► INVESTIGATING ──┬─► RCA_COMPLETE ──┬─► PENDING_APPROVAL ──┬─► REMEDIATING ──┬─► VERIFYING ──┬─► RESOLVED ──► CLOSED
 *                      │                   │                  │                     │                 │                │
 *                      └─► ESCALATED ◄─────┴──────────────────┴─────────────────────┘                 │                ├─► REMEDIATING (retry)
 *                          │      ▲                                                                     │                └─► ESCALATED
 *                          │      └── FAILED ◄───────────────────────────────────────────────────────────┘
 *                          └─► CLOSED
 */
const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  NEW: ["INVESTIGATING", "ESCALATED"],
  INVESTIGATING: ["RCA_COMPLETE", "ESCALATED", "FAILED"],
  RCA_COMPLETE: ["PENDING_APPROVAL", "REMEDIATING", "ESCALATED"],
  PENDING_APPROVAL: ["REMEDIATING", "ESCALATED", "CLOSED"],
  REMEDIATING: ["VERIFYING", "FAILED"],
  VERIFYING: ["RESOLVED", "REMEDIATING", "ESCALATED"],
  RESOLVED: ["CLOSED"],
  ESCALATED: ["INVESTIGATING", "CLOSED"],
  FAILED: ["INVESTIGATING", "CLOSED"],
  CLOSED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: IncidentStatus,
    public readonly to: IncidentStatus,
  ) {
    super(`Cannot transition an incident from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws IllegalTransitionError if the transition isn't allowed; otherwise a no-op that
 *  returns `to` — callers use this as the single gate before writing a new status,
 *  typically alongside an IncidentEvent row recording who/what triggered it. */
export function transition(from: IncidentStatus, to: IncidentStatus): IncidentStatus {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
  return to;
}

export function isTerminal(status: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
