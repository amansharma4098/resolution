"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface IncidentDetail {
  id: string;
  externalId: string;
  source: string;
  title: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  priority: string;
  status: string;
  service: string | null;
  environment: string | null;
  resource: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// useSearchParams() opts a page out of static prerendering unless wrapped in Suspense —
// required here since apps/web builds as a static export (next.config.js).
export default function IncidentDetailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-subink">Loading…</p>}>
      <IncidentDetailContent />
    </Suspense>
  );
}

function IncidentDetailContent() {
  const id = useSearchParams().get("id");
  const { currentOrganizationId } = useSession();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentOrganizationId || !id) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ incident: IncidentDetail }>(`/api/incidents/${id}`, {
        organizationId: currentOrganizationId,
      });
      setIncident(res.incident);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load incident");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-subink">Loading…</p>;
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!incident) return <p className="text-sm text-subink">Incident not found.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Incident</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold text-ink">{incident.title}</h1>
          <StatusBadge status={domainStatusMap.severity[incident.severity]}>{incident.severity}</StatusBadge>
          <StatusBadge status="neutral">{incident.status}</StatusBadge>
        </div>
        <p className="mt-1 font-mono text-xs text-subink">
          {incident.source} · {incident.externalId} · {incident.priority}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-ink">{incident.description || "No description."}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-subink">Service</p>
            <p className="text-sm text-ink">{incident.service ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-subink">Environment</p>
            <p className="text-sm text-ink">{incident.environment ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-subink">Created</p>
            <p className="text-sm text-ink">{new Date(incident.createdAt).toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded bg-background p-3 font-mono text-xs text-subink">
            {JSON.stringify(incident.metadata, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
