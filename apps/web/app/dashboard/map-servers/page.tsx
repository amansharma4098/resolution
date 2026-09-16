"use client";

import { RecoveryRuleForm } from "@/components/recovery-rule-form";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface CatalogEntry {
  type: string;
  available: boolean;
  displayName: string;
  isMock: boolean;
  capabilityCount: number;
}

interface MapServerSummary {
  id: string;
  type: string;
  name: string;
  credentialId: string | null;
  config: { disabled?: boolean; recoveryRules?: Record<string, Record<string, unknown>> };
  environments: string[];
  isMock: boolean;
  status: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";
}

interface CredentialOption {
  id: string;
  name: string;
}

interface Capability {
  fingerprint?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  key: string;
  enabled: boolean;
  riskLevel: string;
  mutating: boolean;
}

export default function MapServersPage() {
  const { currentTenantId } = useSession();
  const [mapServers, setMapServers] = useState<MapServerSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testDetail, setTestDetail] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [capabilitiesByServer, setCapabilitiesByServer] = useState<Record<string, Capability[]>>(
    {},
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);
    try {
      const [msRes, catalogRes, credsRes] = await Promise.all([
        apiRequest<{ mapServers: MapServerSummary[] }>("/api/map-servers", {
          tenantId: currentTenantId,
        }),
        apiRequest<{ catalog: CatalogEntry[] }>("/api/map-servers/catalog", {
          tenantId: currentTenantId,
        }),
        apiRequest<{ credentials: CredentialOption[] }>("/api/credentials", {
          tenantId: currentTenantId,
        }),
      ]);
      setMapServers(msRes.mapServers);
      setCatalog(catalogRes.catalog);
      setCredentials(credsRes.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load Connections");
    } finally {
      setLoading(false);
    }
  }, [currentTenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTest(id: string) {
    if (!currentTenantId) return;
    try {
      const res = await apiRequest<{ detail: string }>(`/api/map-servers/${id}/test`, {
        method: "POST",
        tenantId: currentTenantId,
      });
      setTestDetail((d) => ({ ...d, [id]: res.detail }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed");
    }
  }

  async function refreshTools(id: string) {
    if (!currentTenantId) return;
    try {
      const r = await apiRequest<{ capabilities: Capability[] }>(
        `/api/map-servers/${id}/refresh-capabilities`,
        { method: "POST", tenantId: currentTenantId },
      );
      setCapabilitiesByServer((prev) => ({ ...prev, [id]: r.capabilities }));
      setExpanded((prev) => new Set([...prev, id]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Discovery failed");
    }
  }
  async function setDisabled(id: string, disabled: boolean) {
    if (!currentTenantId) return;
    try {
      await apiRequest(`/api/map-servers/${id}`, {
        method: "PATCH",
        tenantId: currentTenantId,
        body: { disabled },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connection update failed");
    }
  }

  async function handleDelete(id: string) {
    if (!currentTenantId) return;
    try {
      await apiRequest(`/api/map-servers/${id}`, { method: "DELETE", tenantId: currentTenantId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  async function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!capabilitiesByServer[id] && currentTenantId) {
      try {
        const res = await apiRequest<{ capabilities: Capability[] }>(`/api/map-servers/${id}`, {
          tenantId: currentTenantId,
        });
        setCapabilitiesByServer((prev) => ({ ...prev, [id]: res.capabilities }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load capabilities");
      }
    }
  }

  async function handleToggleCapability(mapServerId: string, key: string, enabled: boolean) {
    if (!currentTenantId) return;
    try {
      await apiRequest(`/api/map-servers/${mapServerId}/capabilities/${encodeURIComponent(key)}`, {
        method: "PATCH",
        tenantId: currentTenantId,
        body: {
          enabled,
          fingerprint: capabilitiesByServer[mapServerId]?.find((c) => c.key === key)?.fingerprint,
          access: capabilitiesByServer[mapServerId]?.find((c) => c.key === key)?.mutating
            ? "WRITE"
            : "READ",
        },
      });
      const result = await apiRequest<{ capabilities: Capability[] }>(
        `/api/map-servers/${mapServerId}`,
        { tenantId: currentTenantId },
      );
      setCapabilitiesByServer((prev) => ({ ...prev, [mapServerId]: result.capabilities }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update capability");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Configuration</span>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Connections</h1>
          <p className="mt-1 text-sm text-subink">
            The technical systems the AI agent can investigate and act on — each exposes a reviewed
            set of capabilities scoped to your tenant.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New connection"}
        </Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {showForm && (
        <CreateMapServerForm
          catalog={catalog}
          credentials={credentials}
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : mapServers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-subink">
            No Connections configured yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {mapServers.map((ms) => (
            <Card key={ms.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{ms.name}</span>
                    <StatusBadge status={domainStatusMap.connection[ms.status]}>
                      {ms.status}
                    </StatusBadge>
                    {ms.config.disabled && <StatusBadge status="warning">DISABLED</StatusBadge>}
                    {ms.isMock && <StatusBadge status="neutral">MOCK</StatusBadge>}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-subink">
                    <span>{ms.type}</span>
                    <span>{ms.environments.join(", ") || "no environments"}</span>
                  </div>
                  {testDetail[ms.id] && <p className="text-xs text-subink">{testDetail[ms.id]}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void toggleExpanded(ms.id)}>
                    {expanded.has(ms.id) ? "Hide capabilities" : "Capabilities"}
                  </Button>
                  {ms.type === "MCP" && (
                    <Button size="sm" variant="secondary" onClick={() => void refreshTools(ms.id)}>
                      Discover tools
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void setDisabled(ms.id, !ms.config.disabled)}
                  >
                    {ms.config.disabled ? "Enable connection" : "Disable connection"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void handleTest(ms.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleDelete(ms.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
              {expanded.has(ms.id) && (
                <CardContent className="border-t border-border pt-4">
                  {!capabilitiesByServer[ms.id] ? (
                    <p className="text-xs text-subink">Loading…</p>
                  ) : capabilitiesByServer[ms.id]!.length === 0 ? (
                    <p className="text-xs text-subink">
                      No provider is registered for {ms.type} yet, so there&apos;s nothing to enable
                      — capabilities appear automatically once one ships.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {capabilitiesByServer[ms.id]!.map((cap) => (
                        <div key={cap.key} className="rounded border border-border p-3">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={cap.enabled}
                              onChange={(e) =>
                                void handleToggleCapability(ms.id, cap.key, e.target.checked)
                              }
                            />
                            <span className="font-mono text-xs text-ink">{cap.key}</span>
                            {ms.type === "MCP" && !cap.enabled && (
                              <select
                                aria-label={`Review access for ${cap.key}`}
                                value={cap.mutating ? "WRITE" : "READ"}
                                onChange={(e) =>
                                  setCapabilitiesByServer((prev) => ({
                                    ...prev,
                                    [ms.id]: prev[ms.id]!.map((c) =>
                                      c.key === cap.key
                                        ? { ...c, mutating: e.target.value === "WRITE" }
                                        : c,
                                    ),
                                  }))
                                }
                              >
                                <option value="WRITE">Review as write access</option>
                                <option value="READ">Review as read-only</option>
                              </select>
                            )}
                            <StatusBadge status={cap.mutating ? "warning" : "success"}>
                              {cap.mutating ? "MUTATING" : "READ-ONLY"}
                            </StatusBadge>
                            <span className="font-mono text-xs text-subink">{cap.riskLevel}</span>
                          </label>
                          {cap.description && (
                            <p className="mt-2 text-xs text-subink">{cap.description}</p>
                          )}
                          {ms.type === "MCP" && cap.enabled && cap.mutating && (
                            <RecoveryRuleForm
                              serverId={ms.id}
                              action={cap}
                              tools={capabilitiesByServer[ms.id]!}
                              saved={
                                (
                                  ms.config.recoveryRules as
                                    Record<string, Record<string, unknown>> | undefined
                                )?.[cap.key]
                              }
                            />
                          )}
                          {cap.inputSchema && (
                            <details className="mt-2 text-xs text-subink">
                              <summary>Review tool parameters</summary>
                              <pre className="mt-2 overflow-auto">
                                {JSON.stringify(cap.inputSchema, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateMapServerForm({
  catalog,
  credentials,
  onCreated,
  onError,
}: {
  catalog: CatalogEntry[];
  credentials: CredentialOption[];
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const { currentTenantId } = useSession();
  const [type, setType] = useState("MCP");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [environments, setEnvironments] = useState("prod");
  const [configJson, setConfigJson] = useState("{\n  \n}");
  const [submitting, setSubmitting] = useState(false);

  const selectedEntry = catalog.find((c) => c.type === type);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTenantId) return;
    setSubmitting(true);
    try {
      const config = type === "MCP" ? { url } : JSON.parse(configJson);
      await apiRequest("/api/map-servers", {
        method: "POST",
        tenantId: currentTenantId,
        body: {
          type,
          name,
          credentialId: credentialId || undefined,
          environments: environments
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean),
          config,
        },
      });
      onCreated();
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : "Failed to create connection — check the config is valid JSON",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New connection</CardTitle>
        <CardDescription>
          You can configure a provider before it&apos;s available — it will just show as not yet
          connectable until we ship it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-type">Type</Label>
              <Select id="ms-type" value={type} onChange={(e) => setType(e.target.value)}>
                {catalog.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.displayName} {c.available ? "" : "(not yet available)"}
                  </option>
                ))}
              </Select>
              {selectedEntry && !selectedEntry.available && (
                <p className="text-xs text-subink">
                  No provider is registered for this type yet — you can still save the
                  configuration.
                </p>
              )}
              {selectedEntry?.isMock && (
                <p className="text-xs text-subink">This provider runs in MOCK mode.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-name">Name</Label>
              <Input id="ms-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-credential">Credential</Label>
              <Select
                id="ms-credential"
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
              >
                <option value="">None</option>
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-environments">Environments (comma-separated)</Label>
              <Input
                id="ms-environments"
                value={environments}
                onChange={(e) => setEnvironments(e.target.value)}
              />
            </div>
          </div>
          {type === "MCP" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-url">MCP endpoint</Label>
              <Input
                id="ms-url"
                type="url"
                required
                placeholder="https://mcp.example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-subink">
                Use a public HTTPS endpoint. Add its token in Credentials, then select it above.
                Discover and review tools after connecting.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-config">Config (JSON)</Label>
              <Textarea
                id="ms-config"
                rows={5}
                className="font-mono"
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Creating…" : "Create connection"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
