export interface NavItem {
  label: string;
  href: string;
  /** Phase this ships in, per IMPLEMENTATION_PLAN.md — shown as a "Soon" tag instead of a
   *  broken/fake link until it's real. Never render a nav item as active without a page
   *  behind it. */
  builtInPhase?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Incidents", href: "/dashboard/incidents", builtInPhase: 6 },
  { label: "AI Investigations", href: "/dashboard/investigations", builtInPhase: 7 },
  { label: "Map Servers", href: "/dashboard/map-servers", builtInPhase: 2 },
  { label: "Credentials", href: "/dashboard/credentials", builtInPhase: 2 },
  { label: "Knowledge", href: "/dashboard/knowledge", builtInPhase: 7 },
  { label: "Runbooks", href: "/dashboard/runbooks", builtInPhase: 8 },
  { label: "Automation Policies", href: "/dashboard/policies", builtInPhase: 8 },
  { label: "Approvals", href: "/dashboard/approvals", builtInPhase: 8 },
  { label: "Audit Logs", href: "/dashboard/audit", builtInPhase: 9 },
  { label: "Integrations", href: "/dashboard/integrations", builtInPhase: 2 },
  { label: "Analytics", href: "/dashboard/analytics", builtInPhase: 9 },
  { label: "Settings", href: "/dashboard/settings" },
  { label: "Billing", href: "/dashboard/billing", builtInPhase: 11 },
];
