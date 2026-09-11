"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface IncidentSummary {
  id: string;
  externalId: string;
  source: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  priority: string;
  status: string;
  service: string | null;
  createdAt: string;
}

export default function IncidentsPage() {
  const { currentOrganizationId } = useSession();
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ incidents: IncidentSummary[] }>("/api/incidents", {
        organizationId: currentOrganizationId,
      });
      setIncidents(res.incidents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load incidents");
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
        <span className="kicker">Incidents</span>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Incidents</h1>
        <p className="mt-1 text-sm text-subink">
          Ingested from connected sources (Jira today). AI investigation, RCA, and
          remediation land in Phases 6–8 — this is real ingestion, not yet the full
          lifecycle.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : incidents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-subink">
            No incidents yet. Connect a Jira integration and its webhook to start ingesting
            real incidents — see the Integrations page.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {incidents.map((i) => (
            <Link key={i.id} href={`/dashboard/incidents/detail?id=${i.id}`}>
              <Card className="transition-colors hover:border-info">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{i.title}</span>
                      <StatusBadge status={domainStatusMap.severity[i.severity]}>{i.severity}</StatusBadge>
                    </div>
                    <span className="font-mono text-xs text-subink">
                      {i.source} · {i.externalId} {i.service ? `· ${i.service}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge
                      status={
                        domainStatusMap.incidentStatus[i.status as keyof typeof domainStatusMap.incidentStatus] ??
                        "neutral"
                      }
                    >
                      {i.status}
                    </StatusBadge>
                    <span className="text-xs text-subink">{new Date(i.createdAt).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
