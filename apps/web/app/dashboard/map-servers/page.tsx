"use client";

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
  environments: string[];
  isMock: boolean;
  status: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";
}

interface CredentialOption {
  id: string;
  name: string;
}

export default function MapServersPage() {
  const { currentOrganizationId } = useSession();
  const [mapServers, setMapServers] = useState<MapServerSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testDetail, setTestDetail] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const [msRes, catalogRes, credsRes] = await Promise.all([
        apiRequest<{ mapServers: MapServerSummary[] }>("/api/map-servers", {
          organizationId: currentOrganizationId,
        }),
        apiRequest<{ catalog: CatalogEntry[] }>("/api/map-servers/catalog", {
          organizationId: currentOrganizationId,
        }),
        apiRequest<{ credentials: CredentialOption[] }>("/api/credentials", {
          organizationId: currentOrganizationId,
        }),
      ]);
      setMapServers(msRes.mapServers);
      setCatalog(catalogRes.catalog);
      setCredentials(credsRes.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load Map Servers");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTest(id: string) {
    if (!currentOrganizationId) return;
    try {
      const res = await apiRequest<{ detail: string }>(`/api/map-servers/${id}/test`, {
        method: "POST",
        organizationId: currentOrganizationId,
      });
      setTestDetail((d) => ({ ...d, [id]: res.detail }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed");
    }
  }

  async function handleDelete(id: string) {
    if (!currentOrganizationId) return;
    try {
      await apiRequest(`/api/map-servers/${id}`, { method: "DELETE", organizationId: currentOrganizationId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Configuration</span>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Map Servers</h1>
          <p className="mt-1 text-sm text-subink">
            The technical systems the AI agent can investigate and act on — each exposes a
            fixed set of typed capabilities.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "New Map Server"}</Button>
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
            No Map Servers configured yet.
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
                    <StatusBadge status={domainStatusMap.connection[ms.status]}>{ms.status}</StatusBadge>
                    {ms.isMock && <StatusBadge status="neutral">MOCK</StatusBadge>}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-subink">
                    <span>{ms.type}</span>
                    <span>{ms.environments.join(", ") || "no environments"}</span>
                  </div>
                  {testDetail[ms.id] && <p className="text-xs text-subink">{testDetail[ms.id]}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handleTest(ms.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleDelete(ms.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
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
  const { currentOrganizationId } = useSession();
  const [type, setType] = useState(catalog[0]?.type ?? "FABRIC");
  const [name, setName] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [environments, setEnvironments] = useState("prod");
  const [configJson, setConfigJson] = useState("{\n  \n}");
  const [submitting, setSubmitting] = useState(false);

  const selectedEntry = catalog.find((c) => c.type === type);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrganizationId) return;
    setSubmitting(true);
    try {
      const config = JSON.parse(configJson);
      await apiRequest("/api/map-servers", {
        method: "POST",
        organizationId: currentOrganizationId,
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
      onError(err instanceof ApiError ? err.message : "Failed to create Map Server — check the config is valid JSON");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Map Server</CardTitle>
        <CardDescription>
          You can configure a provider before it&apos;s available — it will just show as
          not yet connectable until we ship it.
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
              <Select id="ms-credential" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
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
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Creating…" : "Create Map Server"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
