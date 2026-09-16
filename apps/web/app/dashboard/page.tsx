"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface Metrics {
  incidents: {
    total: number;
    open: number;
    byStatus: Record<string, number>;
    avgResolutionTimeMs: number | null;
  };
  remediation: {
    proposed: number;
    deniedByPolicy: number;
    approvalPending: number;
    approved: number;
    rejected: number;
    executing: number;
    succeeded: number;
    failed: number;
    noActionCount: number;
  };
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-subink">{label}</p>
        <p className="mt-1 font-display text-2xl font-semibold text-ink">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-subink">{sub}</p>}
      </CardContent>
    </Card>
  );
}

interface SetupState {
  hasCredential: boolean;
  hasIntegration: boolean;
  hasMcpServer: boolean;
}

/** The three things a brand-new org needs before an incident can show up here at all, let
 *  alone get auto-resolved — surfaced as a checklist instead of a wall of zeros, so a new
 *  user knows exactly what to click first instead of guessing between five config pages. */
function GettingStarted({ setup }: { setup: SetupState }) {
  const completed = [setup.hasCredential, setup.hasIntegration, setup.hasMcpServer].filter(
    Boolean,
  ).length;
  const steps = [
    {
      done: setup.hasCredential,
      label: "Add a credential",
      detail:
        "Store an API key or service login once, then reuse it safely across connected systems.",
      href: "/dashboard/credentials",
      cta: "Add credential",
    },
    {
      done: setup.hasIntegration,
      label: "Connect an incident source",
      detail:
        "Datadog, Jira, ServiceNow, or a generic webhook can create incidents in this workspace.",
      href: "/dashboard/integrations",
      cta: "Add integration",
    },
    {
      done: setup.hasMcpServer,
      label: "Connect an MCP Server",
      detail:
        "Give the agent specific read and remediation capabilities against an operational system you approve.",
      href: "/dashboard/map-servers",
      cta: "Add MCP Server",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
        <CardDescription>
          {completed} of 3 connected. Complete the basics, then choose how much approval the agent
          needs before it can act.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {steps.map((step) => (
          <div
            key={step.label}
            className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  step.done ? "bg-navy text-white" : "border border-border text-subink"
                }`}
              >
                {step.done ? "✓" : ""}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{step.label}</p>
                <p className="text-xs text-subink">{step.detail}</p>
              </div>
            </div>
            {!step.done && (
              <Link href={step.href} className="shrink-0 text-sm text-navy underline">
                {step.cta}
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { currentOrganization, currentTenantId } = useSession();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);
    try {
      const [metricsRes, credentialsRes, integrationsRes, mapServersRes] = await Promise.all([
        apiRequest<Metrics>("/api/metrics", { tenantId: currentTenantId }),
        apiRequest<{ credentials: unknown[] }>("/api/credentials", { tenantId: currentTenantId }),
        apiRequest<{ integrations: unknown[] }>("/api/integrations", { tenantId: currentTenantId }),
        apiRequest<{ mapServers: unknown[] }>("/api/map-servers", { tenantId: currentTenantId }),
      ]);
      setMetrics(metricsRes);
      setSetup({
        hasCredential: credentialsRes.credentials.length > 0,
        hasIntegration: integrationsRes.integrations.length > 0,
        hasMcpServer: mapServersRes.mapServers.length > 0,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [currentTenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Dashboard</span>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {currentOrganization?.name ?? "Your organization"}
        </h1>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {loading || !metrics || !setup ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : !setup.hasCredential || !setup.hasIntegration || !setup.hasMcpServer ? (
        <GettingStarted setup={setup} />
      ) : metrics.incidents.total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>All set — waiting on your first incident</CardTitle>
            <CardDescription>
              Setup is done. When a connected integration sends an incident (or a Datadog monitor
              fires), it will appear here. The agent can investigate automatically; your automation
              policies determine whether a proposed change needs approval.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total incidents" value={metrics.incidents.total} />
            <MetricCard label="Open" value={metrics.incidents.open} />
            <MetricCard label="Resolved" value={metrics.incidents.byStatus.RESOLVED ?? 0} />
            <MetricCard
              label="Avg. resolution time"
              value={formatDuration(metrics.incidents.avgResolutionTimeMs)}
              sub="from ingestion to RESOLVED"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Incidents by status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(metrics.incidents.byStatus)
                .filter(([, count]) => count > 0)
                .map(([status, count]) => (
                  <StatusBadge
                    key={status}
                    status={
                      domainStatusMap.incidentStatus[
                        status as keyof typeof domainStatusMap.incidentStatus
                      ] ?? "neutral"
                    }
                  >
                    {status}: {count}
                  </StatusBadge>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Remediation</CardTitle>
              <CardDescription>
                Every proposal FixCaptain has made, and what happened to it.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <MetricCard label="Proposed" value={metrics.remediation.proposed} />
              <MetricCard label="Auto/approved succeeded" value={metrics.remediation.succeeded} />
              <MetricCard label="Failed" value={metrics.remediation.failed} />
              <MetricCard
                label="Declined (no safe action)"
                value={metrics.remediation.noActionCount}
              />
              <MetricCard label="Denied by policy" value={metrics.remediation.deniedByPolicy} />
              <MetricCard label="Awaiting approval" value={metrics.remediation.approvalPending} />
              <MetricCard label="Approved" value={metrics.remediation.approved} />
              <MetricCard label="Rejected" value={metrics.remediation.rejected} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
