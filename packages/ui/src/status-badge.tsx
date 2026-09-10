import type { ReactNode } from "react";
import { statusColor, type SemanticStatus } from "./tokens";

export interface StatusBadgeProps {
  status: SemanticStatus;
  children: ReactNode;
  /** Renders the label in the monospace font — for capability/tool-call-shaped labels
   *  like AUTO/APPROVAL/DENY, per BUILD spec §13. Defaults on for readability of short
   *  all-caps codes; turn off for prose-like labels ("Connected", "Resolved"). */
  mono?: boolean;
}

/**
 * The one pill/badge pattern used for connection status, policy behavior (AUTO/APPROVAL/
 * DENY), incident severity, and credential status — BUILD spec §13. Status colors are
 * semantic-only; never reach for a raw hex here, always go through `statusColor`.
 */
export function StatusBadge({ status, children, mono = true }: StatusBadgeProps) {
  const { bg, fg } = statusColor[status];
  return (
    <span
      style={{ backgroundColor: bg, color: fg }}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        mono ? "font-mono tracking-tight" : "font-body"
      }`}
    >
      {children}
    </span>
  );
}
