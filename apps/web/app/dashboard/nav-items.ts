export interface NavItem {
  label: string;
  href: string;
  /** Phase this ships in, per IMPLEMENTATION_PLAN.md — shown as a "Soon" tag instead of a
   *  broken/fake link until it's real. Never render a nav item as active without a page
   *  behind it. */
  builtInPhase?: number;
  /** Hides the item entirely (not greyed out — simply absent) for anyone below this role in
   *  the current organization. Only Billing uses this today — a full per-item RBAC nav
   *  (Member vs. Admin vs. Owner) is broader scope than this one page needed. */
  minRole?: "OWNER";
  /** "settings" items render under a collapsed "Settings" heading instead of the main list —
   *  everything the product is actually *for* (incidents, chat, connecting systems) stays
   *  front and center; account/org administration is present but out of the way. */
  group?: "settings";
}

export const NAV_ITEMS: NavItem[] = [
  // --- the product itself ---
  { label: "Dashboard", href: "/dashboard" },
  { label: "Incidents", href: "/dashboard/incidents" },
  { label: "Chat", href: "/dashboard/chat" },
  // AI investigation (evidence, RCA) lives inline on each incident's detail page, not a
  // separate list — every incident is investigated, so a dedicated "AI Investigations" nav
  // item would just be a second, redundant path to the same Incidents list.
  { label: "Integrations", href: "/dashboard/integrations" },
  // The AI agent's connection to a system it can act on. This is Model Context Protocol —
  // one of these can literally be a third-party MCP server, and Resolution exposes its own
  // MCP endpoint too (see docs/mcp-server.md) — so it's named for what it is, not an
  // internal codename ("Map Server" in the DB/API is legacy and stays there, unseen).
  { label: "MCP Servers", href: "/dashboard/map-servers" },

  // --- administration (present, not prominent) ---
  { label: "Automation Policies", href: "/dashboard/automation-policies", group: "settings" },
  { label: "Approvals", href: "/dashboard/approvals", group: "settings" },
  { label: "Credentials", href: "/dashboard/credentials", group: "settings" },
  { label: "Knowledge", href: "/dashboard/knowledge", builtInPhase: 7, group: "settings" },
  { label: "Runbooks", href: "/dashboard/runbooks", builtInPhase: 8, group: "settings" },
  { label: "Audit Logs", href: "/dashboard/audit", group: "settings" },
  { label: "Analytics", href: "/dashboard/analytics", builtInPhase: 9, group: "settings" },
  { label: "Settings", href: "/dashboard/settings", group: "settings" },
  // Personal, not org-scoped (ApiKey.userId, no tenantId) — the only nav item that
  // isn't really "about this organization," same as the account-level /change-password.
  { label: "API Keys", href: "/dashboard/api-keys", group: "settings" },
  { label: "Billing & Credits", href: "/dashboard/billing", minRole: "OWNER", group: "settings" },
];
