"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface AuditEntry {
  id: string;
  actorType: "user" | "agent" | "system";
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export default function AuditLogPage() {
  const { currentOrganizationId } = useSession();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ entries: AuditEntry[]; nextBefore: string | null }>("/api/audit-logs", {
        organizationId: currentOrganizationId,
      });
      setEntries(res.entries);
      setNextBefore(res.nextBefore);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!currentOrganizationId || !nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await apiRequest<{ entries: AuditEntry[]; nextBefore: string | null }>(
        `/api/audit-logs?before=${encodeURIComponent(nextBefore)}`,
        { organizationId: currentOrganizationId },
      );
      setEntries((prev) => [...prev, ...res.entries]);
      setNextBefore(res.nextBefore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [currentOrganizationId, nextBefore]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Audit</span>
        <h1 className="font-display text-2xl font-semibold text-ink">Audit Log</h1>
        <p className="mt-1 text-sm text-subink">
          Every AI tool call and every user-initiated mutating action, most recent first.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{entries.length} entries</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-subink">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-subink">Nothing logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entries.map((e) => (
                <li key={e.id} className="rounded border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-ink">{e.action}</span>
                      <span className="text-xs text-subink">by {e.actorType}</span>
                    </div>
                    <span className="whitespace-nowrap text-xs text-subink">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {e.targetType && (
                    <p className="mt-1 font-mono text-xs text-subink">
                      {e.targetType} · {e.targetId?.slice(0, 8)}
                    </p>
                  )}
                  {Object.keys(e.metadata).length > 0 && (
                    <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 font-mono text-xs text-subink">
                      {JSON.stringify(e.metadata, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
          {nextBefore && (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
