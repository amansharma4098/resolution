"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  status: keyof typeof domainStatusMap.incidentStatus;
  service: string | null;
  environment: string | null;
  resource: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Evidence {
  id: string;
  type: string;
  source: string;
  capabilityKey: string | null;
  summary: string;
  payload: unknown;
  collectedAt: string;
}

interface RcaClaim {
  text: string;
  claimType: "FACT" | "INFERENCE" | "HYPOTHESIS";
  evidenceIds: string[];
  confidence: number;
}

interface Rca {
  id: string;
  summary: string;
  claims: RcaClaim[];
  confidence: number;
  alternativeHypotheses: string[];
  createdAt: string;
}

interface IncidentEventRow {
  id: string;
  type: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

interface Approval {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  requestedAt: string;
  decidedAt: string | null;
  reason: string | null;
}

interface Verification {
  id: string;
  status: "PENDING" | "PASSED" | "FAILED" | "RETRYING";
  actualState: unknown;
  attempt: number;
  checkedAt: string;
}

interface RemediationAction {
  id: string;
  status: "PENDING" | "APPROVED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";
  executedAt: string | null;
  approval: Approval | null;
  verifications: Verification[];
}

interface Resolution {
  id: string;
  proposedAction: string;
  riskLevel: string;
  createdAt: string;
  actions: RemediationAction[];
}

interface IncidentDetailResponse {
  incident: IncidentDetail;
  evidence: Evidence[];
  rca: Rca | null;
  events: IncidentEventRow[];
  resolutions: Resolution[];
}

// A manual (re-)investigate is only meaningful from a state the state machine actually
// allows transitioning to INVESTIGATING from — see packages/agents/src/incident-state-machine.ts.
// Mirrored here just for the button's visibility, not as an authority: the API re-checks
// with canTransition() itself and returns 409 if this ever drifts out of sync.
const INVESTIGATABLE_STATUSES = new Set(["NEW", "ESCALATED", "FAILED"]);

const REMEDIATION_STATUS_MAP: Record<RemediationAction["status"], "success" | "warning" | "error" | "critical" | "info" | "neutral"> = {
  PENDING: "neutral",
  APPROVED: "info",
  EXECUTING: "info",
  SUCCEEDED: "success",
  FAILED: "critical",
  ROLLED_BACK: "warning",
};

const VERIFICATION_STATUS_MAP: Record<Verification["status"], "success" | "warning" | "error" | "critical" | "info" | "neutral"> = {
  PENDING: "neutral",
  PASSED: "success",
  FAILED: "critical",
  RETRYING: "warning",
};

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
  const [data, setData] = useState<IncidentDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [investigating, setInvestigating] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganizationId || !id) return;
    setLoading(true);
    try {
      const res = await apiRequest<IncidentDetailResponse>(`/api/incidents/${id}`, {
        organizationId: currentOrganizationId,
      });
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load incident");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const investigate = useCallback(async () => {
    if (!currentOrganizationId || !id) return;
    setInvestigating(true);
    try {
      // In production this returns as soon as the message is enqueued — the incident stays
      // in whatever status it's at until the queue consumer actually runs. Reloading right
      // after mainly matters for local/test setups, where the inline stand-in processes
      // synchronously; a real deployment needs a manual refresh or poll to see the result.
      await apiRequest(`/api/incidents/${id}/investigate`, { method: "POST", organizationId: currentOrganizationId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start investigation");
    } finally {
      setInvestigating(false);
    }
  }, [currentOrganizationId, id, load]);

  const proposeRemediation = useCallback(async () => {
    if (!currentOrganizationId || !id) return;
    setProposing(true);
    try {
      await apiRequest(`/api/incidents/${id}/propose-remediation`, {
        method: "POST",
        organizationId: currentOrganizationId,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to propose a remediation");
    } finally {
      setProposing(false);
    }
  }, [currentOrganizationId, id, load]);

  const decideApproval = useCallback(
    async (approvalId: string, decision: "APPROVE" | "REJECT") => {
      if (!currentOrganizationId || !id) return;
      setDecidingId(approvalId);
      try {
        await apiRequest(`/api/incidents/${id}/approvals/${approvalId}/decide`, {
          method: "POST",
          organizationId: currentOrganizationId,
          body: { decision },
        });
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to record the decision");
      } finally {
        setDecidingId(null);
      }
    },
    [currentOrganizationId, id, load],
  );

  if (loading) return <p className="text-sm text-subink">Loading…</p>;
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-subink">Incident not found.</p>;

  const { incident, evidence, rca, events, resolutions } = data;
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Incident</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold text-ink">{incident.title}</h1>
          <StatusBadge status={domainStatusMap.severity[incident.severity]}>{incident.severity}</StatusBadge>
          <StatusBadge status={domainStatusMap.incidentStatus[incident.status] ?? "neutral"}>
            {incident.status}
          </StatusBadge>
        </div>
        <p className="mt-1 font-mono text-xs text-subink">
          {incident.source} · {incident.externalId} · {incident.priority}
        </p>
      </div>

      {INVESTIGATABLE_STATUSES.has(incident.status) && (
        <div>
          <Button onClick={() => void investigate()} disabled={investigating}>
            {investigating ? "Investigating…" : "Run investigation"}
          </Button>
        </div>
      )}

      {incident.status === "RCA_COMPLETE" && (
        <div>
          <Button onClick={() => void proposeRemediation()} disabled={proposing}>
            {proposing ? "Proposing…" : "Propose remediation"}
          </Button>
        </div>
      )}

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
          <CardTitle>Root cause analysis</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!rca ? (
            <p className="text-sm text-subink">No root cause analysis yet.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="text-sm text-ink">{rca.summary}</p>
              </div>
              <p className="text-xs text-subink">
                Overall confidence: {Math.round(rca.confidence * 100)}% · {new Date(rca.createdAt).toLocaleString()}
              </p>
              <ul className="flex flex-col gap-2">
                {rca.claims.map((claim, i) => (
                  <li key={i} className="rounded border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={domainStatusMap.rcaClaimType[claim.claimType]}>
                        {claim.claimType}
                      </StatusBadge>
                      <span className="text-xs text-subink">{Math.round(claim.confidence * 100)}% confidence</span>
                    </div>
                    <p className="mt-1 text-sm text-ink">{claim.text}</p>
                    {claim.evidenceIds.length > 0 && (
                      <p className="mt-1 font-mono text-xs text-subink">
                        cites:{" "}
                        {claim.evidenceIds
                          .map((eid) => evidenceById.get(eid)?.capabilityKey ?? eid.slice(0, 8))
                          .join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {rca.alternativeHypotheses.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-subink">Alternative hypotheses</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {rca.alternativeHypotheses.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remediation ({resolutions.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {resolutions.length === 0 ? (
            <p className="text-sm text-subink">No remediation proposed yet.</p>
          ) : (
            resolutions.map((resolution) => (
              <div key={resolution.id} className="rounded border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{resolution.proposedAction}</p>
                  <StatusBadge status={domainStatusMap.severity[resolution.riskLevel as keyof typeof domainStatusMap.severity] ?? "neutral"}>
                    {resolution.riskLevel}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-subink">{new Date(resolution.createdAt).toLocaleString()}</p>

                {resolution.actions.map((action) => (
                  <div key={action.id} className="mt-3 rounded border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-subink">Action</span>
                      <StatusBadge status={REMEDIATION_STATUS_MAP[action.status]}>{action.status}</StatusBadge>
                      {action.executedAt && (
                        <span className="text-xs text-subink">
                          executed {new Date(action.executedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {action.approval && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-subink">Approval</span>
                        <StatusBadge
                          status={
                            action.approval.status === "APPROVED"
                              ? "success"
                              : action.approval.status === "REJECTED"
                                ? "critical"
                                : action.approval.status === "EXPIRED"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {action.approval.status}
                        </StatusBadge>
                        {action.approval.status === "PENDING" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void decideApproval(action.approval!.id, "APPROVE")}
                              disabled={decidingId === action.approval.id}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => void decideApproval(action.approval!.id, "REJECT")}
                              disabled={decidingId === action.approval.id}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {action.verifications.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs font-medium text-subink">Verification</span>
                        <ul className="mt-1 flex flex-col gap-1">
                          {action.verifications.map((v) => (
                            <li key={v.id} className="flex items-center gap-2 text-xs">
                              <StatusBadge status={VERIFICATION_STATUS_MAP[v.status]}>{v.status}</StatusBadge>
                              <span className="text-subink">
                                attempt {v.attempt} · {new Date(v.checkedAt).toLocaleString()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence ({evidence.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {evidence.length === 0 ? (
            <p className="text-sm text-subink">No evidence collected.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evidence.map((e) => (
                <li key={e.id} className="rounded border border-border bg-background p-3">
                  <p className="font-mono text-xs text-subink">
                    {e.type} · {e.capabilityKey ?? "manual"} · {new Date(e.collectedAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm text-ink">{e.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-4 border-b border-border pb-2 text-sm">
                <div>
                  <span className="font-medium text-ink">{e.type}</span>{" "}
                  <span className="text-xs text-subink">by {e.actor}</span>
                </div>
                <span className="whitespace-nowrap text-xs text-subink">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

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
