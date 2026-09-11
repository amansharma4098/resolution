"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

const MAP_SERVER_TYPES = [
  "FABRIC",
  "DATABRICKS",
  "SNOWFLAKE",
  "AZURE",
  "AWS",
  "GCP",
  "KUBERNETES",
  "DATADOG",
  "SPLUNK",
  "DYNATRACE",
  "NEW_RELIC",
  "AIRFLOW",
  "CUSTOM",
];
const BEHAVIORS = ["AUTO", "APPROVAL", "DENY"] as const;
const RESOLUTION_MODES = ["OBSERVE_ONLY", "RECOMMEND", "HUMAN_APPROVED", "AUTONOMOUS"] as const;
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

interface Policy {
  id: string;
  mapServerType: string;
  capabilityKey: string;
  riskLevel: string;
  behavior: "AUTO" | "APPROVAL" | "DENY";
  resolutionModeFloor: string;
}

interface MapServerSummary {
  id: string;
  type: string;
  name: string;
}

interface CapabilityOption {
  key: string;
  riskLevel: string;
  mutating: boolean;
}

export default function AutomationPoliciesPage() {
  const { currentOrganizationId, currentOrganization, refresh } = useSession();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [mapServers, setMapServers] = useState<MapServerSummary[]>([]);
  const [capabilityOptions, setCapabilityOptions] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [formType, setFormType] = useState(MAP_SERVER_TYPES[0]!);
  const [formCapability, setFormCapability] = useState("");
  const [formRisk, setFormRisk] = useState<(typeof RISK_LEVELS)[number]>("LOW");
  const [formBehavior, setFormBehavior] = useState<(typeof BEHAVIORS)[number]>("APPROVAL");
  const [formFloor, setFormFloor] = useState<(typeof RESOLUTION_MODES)[number]>("RECOMMEND");

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const [policiesRes, mapServersRes] = await Promise.all([
        apiRequest<{ policies: Policy[] }>("/api/automation-policies", { organizationId: currentOrganizationId }),
        apiRequest<{ mapServers: MapServerSummary[] }>("/api/map-servers", {
          organizationId: currentOrganizationId,
        }),
      ]);
      setPolicies(policiesRes.policies);
      setMapServers(mapServersRes.mapServers);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load automation policies");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // When the form's mapServerType matches a configured Map Server, offer its actual
  // capabilities as a dropdown instead of a free-text field — falls back to free text when
  // the org hasn't configured one of that type yet.
  useEffect(() => {
    const match = mapServers.find((s) => s.type === formType);
    if (!match || !currentOrganizationId) {
      setCapabilityOptions([]);
      return;
    }
    apiRequest<{ capabilities: CapabilityOption[] }>(`/api/map-servers/${match.id}`, {
      organizationId: currentOrganizationId,
    })
      .then((res) => setCapabilityOptions(res.capabilities))
      .catch(() => setCapabilityOptions([]));
  }, [formType, mapServers, currentOrganizationId]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!currentOrganizationId || !formCapability) return;
      try {
        await apiRequest("/api/automation-policies", {
          method: "PUT",
          organizationId: currentOrganizationId,
          body: {
            mapServerType: formType,
            capabilityKey: formCapability,
            riskLevel: formRisk,
            behavior: formBehavior,
            resolutionModeFloor: formFloor,
          },
        });
        setShowForm(false);
        setFormCapability("");
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to save policy");
      }
    },
    [currentOrganizationId, formType, formCapability, formRisk, formBehavior, formFloor, load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      try {
        await apiRequest(`/api/automation-policies/${id}`, { method: "DELETE", organizationId: currentOrganizationId });
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to delete policy");
      }
    },
    [currentOrganizationId, load],
  );

  const changeResolutionMode = useCallback(
    async (mode: string) => {
      if (!currentOrganizationId) return;
      setSavingMode(true);
      try {
        await apiRequest(`/api/organizations/${currentOrganizationId}`, {
          method: "PATCH",
          organizationId: currentOrganizationId,
          body: { resolutionMode: mode },
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to change resolution mode");
      } finally {
        setSavingMode(false);
      }
    },
    [currentOrganizationId, refresh],
  );

  if (loading) return <p className="text-sm text-subink">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Automation</span>
          <h1 className="font-display text-2xl font-semibold text-ink">Automation Policies</h1>
          <p className="mt-1 text-sm text-subink">
            Every capability an org hasn&apos;t configured here falls back to requiring approval — never auto-run
            unattended.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New policy"}</Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Resolution mode</CardTitle>
          <CardDescription>
            The org-level dial the policy engine reads — a policy&apos;s AUTO behavior can only actually run
            unattended once this is AUTONOMOUS.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select
            value={currentOrganization?.resolutionMode ?? "OBSERVE_ONLY"}
            disabled={savingMode}
            onChange={(e) => void changeResolutionMode(e.target.value)}
            className="max-w-xs"
          >
            {RESOLUTION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </Select>
          {savingMode && <span className="text-xs text-subink">Saving…</span>}
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New / update policy</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="type">Map Server type</Label>
                <Select id="type" value={formType} onChange={(e) => setFormType(e.target.value)}>
                  {MAP_SERVER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="capability">Capability key</Label>
                {capabilityOptions.length > 0 ? (
                  <Select
                    id="capability"
                    value={formCapability}
                    onChange={(e) => setFormCapability(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {capabilityOptions.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.key} {c.mutating ? "(mutating)" : "(read-only)"}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input
                    id="capability"
                    value={formCapability}
                    onChange={(e) => setFormCapability(e.target.value)}
                    placeholder="e.g. retry_pipeline"
                    required
                    className="h-10 w-full rounded border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
                  />
                )}
              </div>
              <div>
                <Label htmlFor="risk">Risk level</Label>
                <Select id="risk" value={formRisk} onChange={(e) => setFormRisk(e.target.value as typeof formRisk)}>
                  {RISK_LEVELS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="behavior">Behavior</Label>
                <Select
                  id="behavior"
                  value={formBehavior}
                  onChange={(e) => setFormBehavior(e.target.value as typeof formBehavior)}
                >
                  {BEHAVIORS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="floor">Minimum resolution mode (floor)</Label>
                <Select
                  id="floor"
                  value={formFloor}
                  onChange={(e) => setFormFloor(e.target.value as typeof formFloor)}
                >
                  {RESOLUTION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-subink">
                  Below this org resolution mode, this policy is treated as absent (denied) rather than falling back
                  to a weaker behavior.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!formCapability}>
                  Save policy
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Configured policies ({policies.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="text-sm text-subink">No policies configured yet — every capability defaults to APPROVAL.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {policies.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">
                      {p.mapServerType} · {p.capabilityKey}
                    </span>
                    <StatusBadge status={domainStatusMap.severity[p.riskLevel as keyof typeof domainStatusMap.severity] ?? "neutral"}>
                      {p.riskLevel}
                    </StatusBadge>
                    <StatusBadge status={p.behavior === "AUTO" ? "success" : p.behavior === "DENY" ? "critical" : "warning"}>
                      {p.behavior}
                    </StatusBadge>
                    <span className="text-xs text-subink">floor: {p.resolutionModeFloor}</span>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => void remove(p.id)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
