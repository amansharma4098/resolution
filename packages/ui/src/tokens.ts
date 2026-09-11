/**
 * Design tokens — the single source of truth for the platform's visual language.
 * See BUILD spec §13. Never hardcode these hex values in components; import from here
 * (or the generated CSS variables in globals.css) so every screen stays consistent with
 * the pitch-deck visual bar by construction.
 */

export const colors = {
  brand: {
    navy: "#1E2761", // primary brand color — headers, primary buttons, nav, dark sections
    navyDark: "#161B4D", // hero/closing backgrounds, decorative shapes
    ice: "#CADCFC", // on-navy secondary text, chips, highlights on dark backgrounds
  },
  neutral: {
    background: "#F7F8FC", // app background (light mode)
    surface: "#FFFFFF", // cards, panels, tables
    border: "#E3E7F1", // card/table borders, dividers
    ink: "#111827", // primary text
    subink: "#5B6273", // secondary / muted text
  },
  // Semantic status — use ONLY for status, never decoration.
  status: {
    success: "#16A34A", // AUTO, Connected, Valid, Resolved
    warning: "#D97706", // APPROVAL required, Pending
    error: "#DC2626", // Failed, Not configured
    critical: "#B91C1C", // DENY, Critical severity
    info: "#2563EB", // primary actions, links, informational badges
  },
  // Dark-mode surfaces (same semantic status colors — see globals.css for the media-query wiring)
  dark: {
    background: "#0F1233",
    surface: "#161B4D",
    border: "#2B3166",
    ink: "#F7F8FC",
    subink: "#CADCFC",
  },
} as const;

export const typography = {
  fontDisplay: '"Cambria", "Georgia", serif', // headers
  fontBody: '"Calibri", "Inter", system-ui, sans-serif', // body
  fontMono: '"Courier New", ui-monospace, monospace', // capability names, tool calls, masked secrets
  kicker: {
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    fontWeight: 600,
    color: colors.status.info,
  },
  scale: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem",
  },
} as const;

export const radius = {
  sm: "6px",
  md: "8px", // default card radius
  lg: "12px",
  full: "9999px", // pills/badges
} as const;

export const shadow = {
  card: "0 1px 2px 0 rgb(17 24 39 / 0.05), 0 1px 3px 0 rgb(17 24 39 / 0.06)",
} as const;

/** Status → semantic color mapping used by StatusBadge, connection/policy/severity pills. */
export type SemanticStatus = "success" | "warning" | "error" | "critical" | "info" | "neutral";

export const statusColor: Record<SemanticStatus, { bg: string; fg: string }> = {
  success: { bg: colors.status.success, fg: "#FFFFFF" },
  warning: { bg: colors.status.warning, fg: "#FFFFFF" },
  error: { bg: colors.status.error, fg: "#FFFFFF" },
  critical: { bg: colors.status.critical, fg: "#FFFFFF" },
  info: { bg: colors.status.info, fg: "#FFFFFF" },
  neutral: { bg: colors.neutral.subink, fg: "#FFFFFF" },
};

/** Canonical mapping from domain states to a SemanticStatus — keeps color meaning consistent
 *  across ConnectionStatus, PolicyBehavior and Severity instead of each component reinventing it. */
export const domainStatusMap = {
  connection: {
    CONNECTED: "success",
    DEGRADED: "warning",
    DISCONNECTED: "error",
    UNCONFIGURED: "neutral",
  },
  policyBehavior: {
    AUTO: "success",
    APPROVAL: "warning",
    DENY: "critical",
  },
  severity: {
    CRITICAL: "critical",
    HIGH: "error",
    MEDIUM: "warning",
    LOW: "info",
  },
  credentialStatus: {
    VALID: "success",
    UNVERIFIED: "neutral",
    INVALID: "error",
    EXPIRED: "warning",
  },
  incidentStatus: {
    NEW: "neutral",
    INVESTIGATING: "info",
    RCA_COMPLETE: "info",
    PENDING_APPROVAL: "warning",
    REMEDIATING: "info",
    VERIFYING: "info",
    RESOLVED: "success",
    ESCALATED: "critical",
    FAILED: "critical",
    CLOSED: "neutral",
  },
  // RCA claim type (packages/shared/src/rca.ts) — FACT/INFERENCE/HYPOTHESIS, ordered from
  // most to least certain; the color scale reflects that ordering, not correctness/error.
  rcaClaimType: {
    FACT: "success",
    INFERENCE: "info",
    HYPOTHESIS: "warning",
  },
} as const satisfies Record<string, Record<string, SemanticStatus>>;
