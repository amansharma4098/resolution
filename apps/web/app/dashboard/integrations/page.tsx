"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

const INCIDENT_SOURCE_TYPES = ["JIRA", "SERVICENOW", "PAGERDUTY", "WEBHOOK"] as const;

interface IntegrationSummary {
  id: string;
  type: string;
  name: string;
  status: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";
}

interface CredentialOption {
  id: string;
  name: string;
}

export default function IntegrationsPage() {
  const { currentOrganizationId } = useSession();
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const [intRes, credsRes] = await Promise.all([
        apiRequest<{ integrations: IntegrationSummary[] }>("/api/integrations", {
          organizationId: currentOrganizationId,
        }),
        apiRequest<{ credentials: CredentialOption[] }>("/api/credentials", {
          organizationId: currentOrganizationId,
        }),
      ]);
      setIntegrations(intRes.integrations);
      setCredentials(credsRes.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: string) {
    if (!currentOrganizationId) return;
    try {
      await apiRequest(`/api/integrations/${id}`, { method: "DELETE", organizationId: currentOrganizationId });
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
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Integrations</h1>
          <p className="mt-1 text-sm text-subink">
            Where incidents originate — Jira, ServiceNow, PagerDuty, or a custom webhook.
            OAuth and live ingestion for Jira and ServiceNow ship in Phases 3–4.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "New integration"}</Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {showForm && (
        <CreateIntegrationForm
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
      ) : integrations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-subink">
            No integrations configured yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {integrations.map((i) => (
            <Card key={i.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{i.name}</span>
                    <StatusBadge status={domainStatusMap.connection[i.status]}>{i.status}</StatusBadge>
                  </div>
                  <span className="font-mono text-xs text-subink">{i.type}</span>
                </div>
                <Button size="sm" variant="danger" onClick={() => void handleDelete(i.id)}>
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateIntegrationForm({
  credentials,
  onCreated,
  onError,
}: {
  credentials: CredentialOption[];
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const { currentOrganizationId } = useSession();
  const [type, setType] = useState<(typeof INCIDENT_SOURCE_TYPES)[number]>("JIRA");
  const [name, setName] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrganizationId) return;
    setSubmitting(true);
    try {
      await apiRequest("/api/integrations", {
        method: "POST",
        organizationId: currentOrganizationId,
        body: { type, name, credentialId: credentialId || undefined },
      });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to create integration");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New integration</CardTitle>
        <CardDescription>Where incidents will come from.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-type">Type</Label>
              <Select
                id="int-type"
                value={type}
                onChange={(e) => setType(e.target.value as (typeof INCIDENT_SOURCE_TYPES)[number])}
              >
                {INCIDENT_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-name">Name</Label>
              <Input id="int-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="int-credential">Credential</Label>
            <Select id="int-credential" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
              <option value="">None</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Creating…" : "Create integration"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
