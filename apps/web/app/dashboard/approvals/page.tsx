"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface PendingApproval {
  incidentId: string;
  incidentTitle: string;
  incidentSeverity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  approvalId: string;
  proposedAction: string;
  riskLevel: string;
  requestedAt: string;
}

/** A global inbox over every incident's pending approval — ARCHITECTURE.md §7's
 *  APPROVAL-gated remediations. The actual decide action lives on the incident detail page
 *  (it needs the full RCA/evidence context to decide responsibly); this page is purely "what
 *  needs my attention right now", so each row links straight there. */
export default function ApprovalsPage() {
  const { currentOrganizationId } = useSession();
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ pending: PendingApproval[] }>("/api/incidents/approvals/pending", {
        organizationId: currentOrganizationId,
      });
      setPending(res.pending);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load pending approvals");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Automation</span>
          <h1 className="font-display text-2xl font-semibold text-ink">Approvals</h1>
          <p className="mt-1 text-sm text-subink">
            Remediations the policy engine gated on human approval — see ARCHITECTURE.md §7.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : pending.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-subink">Nothing waiting on approval.</CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((p) => (
            <li key={p.approvalId}>
              <Link href={`/dashboard/incidents/detail?id=${p.incidentId}`}>
                <Card className="transition-colors hover:bg-background">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{p.incidentTitle}</span>
                        <StatusBadge status={domainStatusMap.severity[p.incidentSeverity]}>
                          {p.incidentSeverity}
                        </StatusBadge>
                        <StatusBadge status={domainStatusMap.severity[p.riskLevel as keyof typeof domainStatusMap.severity] ?? "neutral"}>
                          {p.riskLevel}
                        </StatusBadge>
                      </div>
                      <span className="text-sm text-subink">{p.proposedAction}</span>
                    </div>
                    <span className="whitespace-nowrap text-xs text-subink">
                      {new Date(p.requestedAt).toLocaleString()}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
