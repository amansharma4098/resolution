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
const WEBHOOK_BASED = new Set(["JIRA", "SERVICENOW"]);

interface IntegrationSummary {
  id: string;
  type: string;
  name: string;
  status: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";
  config: Record<string, unknown>;
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
  const [testDetail, setTestDetail] = useState<Record<string, string>>({});
  const [webhookNotice, setWebhookNotice] = useState<{ url: string; secret: string } | null>(null);

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

  async function handleTest(id: string) {
    if (!currentOrganizationId) return;
    try {
      const res = await apiRequest<{ detail: string }>(`/api/integrations/${id}/test`, {
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
            Where incidents originate. Jira and ServiceNow are both real, end to end:
            connectivity test hits the real API, and each webhook receiver creates real
            incidents. PagerDuty and a generic webhook source are next.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "New integration"}</Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {webhookNotice && (
        <Card emphasized>
          <CardContent className="flex flex-col gap-2 py-4 text-white">
            <p className="text-sm">
              Configure your Jira instance to send its issue webhook here, with header{" "}
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">X-Webhook-Secret</code>{" "}
              set to the value below — shown once, won&apos;t be shown again:
            </p>
            <p className="rounded bg-white/10 px-3 py-2 font-mono text-xs break-all">{webhookNotice.url}</p>
            <p className="rounded bg-white/10 px-3 py-2 font-mono text-xs break-all">{webhookNotice.secret}</p>
            <Button size="sm" variant="secondary" className="self-start" onClick={() => setWebhookNotice(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <CreateIntegrationForm
          credentials={credentials}
          onCreated={(webhook) => {
            setShowForm(false);
            if (webhook) setWebhookNotice(webhook);
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
                  {testDetail[i.id] && <p className="text-xs text-subink">{testDetail[i.id]}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handleTest(i.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleDelete(i.id)}>
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

function CreateIntegrationForm({
  credentials,
  onCreated,
  onError,
}: {
  credentials: CredentialOption[];
  onCreated: (webhook: { url: string; secret: string } | null) => void;
  onError: (msg: string) => void;
}) {
  const { currentOrganizationId } = useSession();
  const [type, setType] = useState<(typeof INCIDENT_SOURCE_TYPES)[number]>("JIRA");
  const [name, setName] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrganizationId) return;
    setSubmitting(true);
    try {
      const config: Record<string, unknown> = {};
      if ((type === "JIRA" || type === "SERVICENOW") && baseUrl) config.baseUrl = baseUrl;

      const res = await apiRequest<{
        integration: IntegrationSummary;
        webhookUrl?: string;
      }>("/api/integrations", {
        method: "POST",
        organizationId: currentOrganizationId,
        body: { type, name, credentialId: credentialId || undefined, config },
      });

      onCreated(
        res.webhookUrl
          ? { url: res.webhookUrl, secret: String(res.integration.config.webhookSecret) }
          : null,
      );
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
          {(type === "JIRA" || type === "SERVICENOW") && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-base-url">{type === "JIRA" ? "Jira site URL" : "ServiceNow instance URL"}</Label>
              <Input
                id="int-base-url"
                placeholder={
                  type === "JIRA" ? "https://your-domain.atlassian.net" : "https://your-instance.service-now.com"
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          )}
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
            {type === "JIRA" && (
              <p className="text-xs text-subink">
                Use a BASIC_AUTH credential — username is your Atlassian account email,
                password is an API token from id.atlassian.com/manage-profile/security/api-tokens.
              </p>
            )}
            {type === "SERVICENOW" && (
              <p className="text-xs text-subink">
                Use a BASIC_AUTH credential with a ServiceNow username and password that
                has Table API access.
              </p>
            )}
          </div>
          {WEBHOOK_BASED.has(type) && (
            <p className="text-xs text-subink">
              A webhook URL and secret are generated after creation — configure your source
              system&apos;s outgoing webhook with them.
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Creating…" : "Create integration"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
