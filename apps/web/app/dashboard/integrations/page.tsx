"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge, domainStatusMap } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

const INCIDENT_SOURCE_TYPES = [
  "JIRA",
  "AZURE_MONITOR",
  "SERVICENOW",
  "DATADOG",
  "WEBHOOK",
] as const;
const WEBHOOK_BASED = new Set(["JIRA", "SERVICENOW", "WEBHOOK", "DATADOG"]);

const POLLING = new Set(["JIRA", "AZURE_MONITOR", "SERVICENOW"]);
const SOURCE_NAMES: Record<string, string> = {
  JIRA: "Jira Cloud",
  AZURE_MONITOR: "Azure Monitor",
  SERVICENOW: "ServiceNow",
  DATADOG: "Datadog",
  WEBHOOK: "Other platform (webhook)",
};

interface IntegrationSummary {
  id: string;
  type: string;
  name: string;
  status: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNCONFIGURED";
  config: Record<string, unknown>;
  credentialId?: string;
  syncEnabled?: boolean;
  lastSyncedAt?: string;
  syncError?: string;
}

interface CredentialOption {
  id: string;
  name: string;
}

export default function IntegrationsPage() {
  const { currentTenantId } = useSession();
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<IntegrationSummary | undefined>();
  const [testDetail, setTestDetail] = useState<Record<string, string>>({});
  const [webhookNotice, setWebhookNotice] = useState<{
    url: string;
    secret: string;
    type: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);
    try {
      const [intRes, credsRes] = await Promise.all([
        apiRequest<{ integrations: IntegrationSummary[] }>("/api/integrations", {
          tenantId: currentTenantId,
        }),
        apiRequest<{ credentials: CredentialOption[] }>("/api/credentials", {
          tenantId: currentTenantId,
        }),
      ]);
      setIntegrations(intRes.integrations);
      setCredentials(credsRes.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load integrations");
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
      const res = await apiRequest<{ detail: string }>(`/api/integrations/${id}/test`, {
        method: "POST",
        tenantId: currentTenantId,
      });
      setTestDetail((d) => ({ ...d, [id]: res.detail }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed");
    }
  }

  async function handleDelete(id: string) {
    if (!currentTenantId) return;
    try {
      await apiRequest(`/api/integrations/${id}`, { method: "DELETE", tenantId: currentTenantId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">1 · Detect</span>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Incident sources</h1>
          <p className="mt-1 text-sm text-subink">
            Automatically collect incidents from Jira, Azure Monitor and ServiceNow every five
            minutes. Receive Datadog and other platform alerts by webhook. New incidents start an AI
            investigation.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setShowForm((s) => !s);
          }}
        >
          {showForm ? "Cancel" : "Connect source"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            title: "1. Collect alerts",
            text: "Connect a source and choose the service and environment.",
          },
          {
            title: "2. Investigate together",
            text: "The agent gathers evidence and recommends resolution steps.",
          },
          {
            title: "3. Repair and verify",
            text: "Approved MCP tools apply the fix. Recovery checks gate closure.",
          },
        ].map((step) => (
          <Card key={step.title}>
            <CardContent className="py-4">
              <p className="font-medium text-ink">{step.title}</p>
              <p className="mt-1 text-sm text-subink">{step.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-subink">
        Next:{" "}
        <Link className="underline" href="/dashboard/map-servers">
          connect investigation and repair tools
        </Link>
        , then{" "}
        <Link className="underline" href="/dashboard/incidents">
          open the incident inbox
        </Link>
        .
      </p>
      {error && <p className="text-sm text-error">{error}</p>}

      {webhookNotice && (
        <Card emphasized>
          <CardContent className="flex flex-col gap-2 py-4 text-white">
            <p className="text-sm">
              {webhookNotice.type === "WEBHOOK"
                ? "Send events here, with header"
                : webhookNotice.type === "DATADOG"
                  ? "In Datadog, add a Webhooks integration pointing here, with a custom header"
                  : `Optional: receive faster updates from ${webhookNotice.type === "JIRA" ? "Jira" : "ServiceNow"} by sending webhooks here, with header`}{" "}
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">
                X-Webhook-Secret
              </code>{" "}
              set to the value below — shown once, won&apos;t be shown again:
            </p>
            <p className="rounded bg-white/10 px-3 py-2 font-mono text-xs break-all">
              {webhookNotice.url}
            </p>
            <p className="rounded bg-white/10 px-3 py-2 font-mono text-xs break-all">
              {webhookNotice.secret}
            </p>
            {webhookNotice.type === "WEBHOOK" && (
              <pre className="overflow-x-auto rounded bg-white/10 px-3 py-2 font-mono text-xs">
                {`POST, with X-Webhook-Secret set as above:
{
  "externalId": "your-own-idempotency-key",
  "title": "Disk usage above 95%",
  "description": "optional",
  "severity": "CRITICAL | HIGH | MEDIUM | LOW",  // default MEDIUM
  "priority": "P1 | P2 | P3 | P4",               // default P3
  "service": "optional",
  "environment": "optional",
  "resource": "optional",
  "metadata": {}                                  // optional, anything you want kept
}`}
              </pre>
            )}
            {webhookNotice.type === "DATADOG" && (
              <>
                <p className="text-xs text-ice">
                  Paste this exact JSON as the webhook&apos;s payload template in Datadog (it
                  substitutes the <span className="font-mono">$VARIABLE</span> tokens before
                  sending) — then add it as a notification target on any monitor, e.g.{" "}
                  <span className="font-mono">@webhook-resolution</span>. Only Triggered/
                  Re-Triggered alerts create an incident; other transitions (Recovered, Warn, …)
                  update nothing.
                </p>
                <pre className="overflow-x-auto rounded bg-white/10 px-3 py-2 font-mono text-xs">
                  {`{
  "alert_id": "$ALERT_ID",
  "alert_transition": "$ALERT_TRANSITION",
  "alert_title": "$ALERT_TITLE",
  "alert_query": "$ALERT_QUERY",
  "event_msg": "$EVENT_MSG",
  "priority": "$ALERT_PRIORITY",
  "host": "$HOSTNAME",
  "tags": "$TAGS",
  "link": "$LINK"
}`}
                </pre>
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => setWebhookNotice(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <CreateIntegrationForm
          key={editing?.id ?? "new"}
          existing={editing}
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
            Connect your first source to start collecting incidents automatically.
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
                    <StatusBadge status={domainStatusMap.connection[i.status]}>
                      {i.status}
                    </StatusBadge>
                  </div>
                  <span className="font-mono text-xs text-subink">
                    {SOURCE_NAMES[i.type] ?? i.type} ·{" "}
                    {i.syncEnabled
                      ? "Collecting every 5 minutes"
                      : POLLING.has(i.type)
                        ? "Collection paused"
                        : "Webhook delivery"}
                  </span>
                  <p className="text-xs text-subink">
                    {i.lastSyncedAt
                      ? `Last collection: ${new Date(i.lastSyncedAt).toLocaleString()}`
                      : "No scheduled collection completed yet"}{" "}
                    · Source closure {i.config.autoClose ? "enabled after verification" : "off"}
                  </p>
                  {i.syncError && <p className="text-xs text-error">{i.syncError}</p>}
                  {testDetail[i.id] && <p className="text-xs text-subink">{testDetail[i.id]}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(i);
                      setShowForm(true);
                    }}
                  >
                    Settings
                  </Button>
                  {POLLING.has(i.type) && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!i.syncEnabled}
                        onClick={async () => {
                          try {
                            await apiRequest(`/api/integrations/${i.id}/sync`, {
                              method: "POST",
                              tenantId: currentTenantId!,
                            });
                            setTestDetail((d) => ({
                              ...d,
                              [i.id]: "Collection queued. Results will appear shortly.",
                            }));
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Collection failed");
                          }
                        }}
                      >
                        Collect now
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await apiRequest(`/api/integrations/${i.id}`, {
                              method: "PATCH",
                              tenantId: currentTenantId!,
                              body: { syncEnabled: !i.syncEnabled },
                            });
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Update failed");
                          }
                        }}
                      >
                        {i.syncEnabled ? "Pause" : "Resume"}
                      </Button>
                    </>
                  )}
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
  existing,
  onCreated,
  onError,
}: {
  credentials: CredentialOption[];
  existing?: IntegrationSummary;
  onCreated: (webhook: { url: string; secret: string; type: string } | null) => void;
  onError: (msg: string) => void;
}) {
  const { currentTenantId } = useSession();
  const [type, setType] = useState<(typeof INCIDENT_SOURCE_TYPES)[number]>(
    (existing?.type as (typeof INCIDENT_SOURCE_TYPES)[number]) ?? "JIRA",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [credentialId, setCredentialId] = useState(existing?.credentialId ?? "");
  const [baseUrl, setBaseUrl] = useState(
    String(existing?.config.baseUrl ?? existing?.config.site ?? ""),
  );
  const [subscriptionId, setSubscriptionId] = useState(
    String(existing?.config.subscriptionId ?? ""),
  );
  const [environment, setEnvironment] = useState(
    String(existing?.config.environment ?? "production"),
  );
  const [service, setService] = useState(String(existing?.config.service ?? ""));
  const [jql, setJql] = useState(
    String(existing?.config.jql ?? "statusCategory != Done ORDER BY created ASC"),
  );
  const [syncEnabled, setSyncEnabled] = useState(existing?.syncEnabled ?? true);
  const [autoClose, setAutoClose] = useState(existing?.config.autoClose === true);
  const [closeValue, setCloseValue] = useState(
    String(existing?.config.resolutionTransitionId ?? existing?.config.closeCode ?? ""),
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTenantId) return;
    setSubmitting(true);
    try {
      const config: Record<string, unknown> = {
        environment,
        service,
        autoClose: POLLING.has(type) && autoClose,
      };
      if (type === "AZURE_MONITOR") config.subscriptionId = subscriptionId;
      if (type === "JIRA") {
        config.jql = jql;
        config.resolutionTransitionId = closeValue;
      }
      if (type === "SERVICENOW") config.closeCode = closeValue;
      if ((type === "JIRA" || type === "SERVICENOW") && baseUrl) config.baseUrl = baseUrl;
      if (type === "DATADOG" && baseUrl) config.site = baseUrl;

      const res = await apiRequest<{
        integration: IntegrationSummary;
        webhookUrl?: string;
      }>(existing ? `/api/integrations/${existing.id}` : "/api/integrations", {
        method: existing ? "PATCH" : "POST",
        tenantId: currentTenantId,
        body: {
          ...(existing ? {} : { type }),
          name,
          credentialId: credentialId || undefined,
          config,
          syncEnabled: POLLING.has(type) && syncEnabled,
        },
      });

      onCreated(
        res.webhookUrl
          ? { url: res.webhookUrl, secret: String(res.integration.config.webhookSecret), type }
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
        <CardTitle>{existing ? "Source settings" : "Connect a source"}</CardTitle>
        <CardDescription>Where incidents will come from.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-type">Type</Label>
              <Select
                id="int-type"
                disabled={Boolean(existing)}
                value={type}
                onChange={(e) => setType(e.target.value as (typeof INCIDENT_SOURCE_TYPES)[number])}
              >
                {INCIDENT_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SOURCE_NAMES[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-name">Name</Label>
              <Input
                id="int-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          {(type === "JIRA" || type === "SERVICENOW" || type === "DATADOG") && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-base-url">
                {type === "JIRA"
                  ? "Jira site URL"
                  : type === "SERVICENOW"
                    ? "ServiceNow instance URL"
                    : "Datadog site (optional)"}
              </Label>
              <Input
                id="int-base-url"
                placeholder={
                  type === "JIRA"
                    ? "https://your-domain.atlassian.net"
                    : type === "SERVICENOW"
                      ? "https://your-instance.service-now.com"
                      : "datadoghq.com (default) · datadoghq.eu · us3.datadoghq.com · …"
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          )}
          {type === "AZURE_MONITOR" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subscription">Azure subscription ID</Label>
              <Input
                id="subscription"
                required
                value={subscriptionId}
                onChange={(e) => setSubscriptionId(e.target.value)}
              />
              <p className="text-xs text-subink">
                Use a SERVICE_PRINCIPAL credential with directory tenant ID, client ID and client
                secret. Grant Monitoring Reader to collect alerts; grant alert state write
                permission only if enabling source closure.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="source-env">Environment</Label>
              <Input
                id="source-env"
                required
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
              />
              <p className="text-xs text-subink">Match this name on your MCP connections.</p>
            </div>
            <div>
              <Label htmlFor="source-service">Default service</Label>
              <Input
                id="source-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
              />
            </div>
          </div>
          {type === "JIRA" && (
            <div>
              <Label htmlFor="source-jql">Jira collection filter (JQL)</Label>
              <Input id="source-jql" value={jql} onChange={(e) => setJql(e.target.value)} />
              <p className="text-xs text-subink">
                Narrow to your incident project or issue type. Done issues are excluded.
              </p>
            </div>
          )}
          {POLLING.has(type) && (
            <div className="flex flex-col gap-3 rounded border border-border p-4">
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={syncEnabled}
                  onChange={(e) => setSyncEnabled(e.target.checked)}
                />
                Automatically collect every five minutes
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoClose}
                  onChange={(e) => setAutoClose(e.target.checked)}
                />
                Update the source as resolved after verified recovery
              </label>
              {autoClose && type !== "AZURE_MONITOR" && (
                <div>
                  <Label htmlFor="close-value">
                    {type === "JIRA" ? "Jira Done transition ID" : "ServiceNow close code"}
                  </Label>
                  <Input
                    id="close-value"
                    required
                    value={closeValue}
                    onChange={(e) => setCloseValue(e.target.value)}
                  />
                </div>
              )}
              {autoClose && type === "AZURE_MONITOR" && (
                <p className="text-xs text-subink">
                  Azure must also report the monitor condition as recovered before FixCaptain closes
                  the alert.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="int-credential">Credential</Label>
            <Select
              id="int-credential"
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
            <Link href="/dashboard/credentials" className="text-xs underline">
              Manage credentials in the encrypted vault
            </Link>
            {type === "JIRA" && (
              <p className="text-xs text-subink">
                Use a BASIC_AUTH credential — username is your Atlassian account email, password is
                an API token from id.atlassian.com/manage-profile/security/api-tokens.
              </p>
            )}
            {type === "SERVICENOW" && (
              <p className="text-xs text-subink">
                Use a BASIC_AUTH credential with a ServiceNow username and password that has Table
                API access.
              </p>
            )}
            {type === "DATADOG" && (
              <p className="text-xs text-subink">
                Use a CUSTOM credential with fields <span className="font-mono">apiKey</span> and{" "}
                <span className="font-mono">applicationKey</span> — an API key and an Application
                key from Organization Settings in Datadog. This one connection supports incident
                delivery and agent access. Review and enable the specific tools under MCP
                Connections after setup.
              </p>
            )}
          </div>
          {WEBHOOK_BASED.has(type) && (
            <p className="text-xs text-subink">
              {POLLING.has(type) ? "Optional: a" : "A"} webhook URL and secret are generated after
              creation — configure your source system&apos;s outgoing webhook with them.
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Saving…" : existing ? "Save settings" : "Connect source"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
