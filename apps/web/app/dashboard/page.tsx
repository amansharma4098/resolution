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

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
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

export default function DashboardPage() {
  const { currentOrganization, currentOrganizationId } = useSession();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const res = await apiRequest<Metrics>("/api/metrics", { organizationId: currentOrganizationId });
      setMetrics(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

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

      {loading || !metrics ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : metrics.incidents.total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing to show yet</CardTitle>
            <CardDescription>
              Incident metrics will appear here once a webhook from a connected integration creates your first
              incident. Set one up under{" "}
              <Link href="/dashboard/integrations" className="text-navy underline">
                Integrations
              </Link>
              .
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
                    status={domainStatusMap.incidentStatus[status as keyof typeof domainStatusMap.incidentStatus] ?? "neutral"}
                  >
                    {status}: {count}
                  </StatusBadge>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Remediation</CardTitle>
              <CardDescription>Every proposal the Resolution Agent has made, and what happened to it.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <MetricCard label="Proposed" value={metrics.remediation.proposed} />
              <MetricCard label="Auto/approved succeeded" value={metrics.remediation.succeeded} />
              <MetricCard label="Failed" value={metrics.remediation.failed} />
              <MetricCard label="Declined (no safe action)" value={metrics.remediation.noActionCount} />
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
