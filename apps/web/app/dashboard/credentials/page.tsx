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
import { AUTHENTICATION_TYPES, CREDENTIAL_FIELDS, type AuthenticationType } from "@/lib/credential-fields";
import { useSession } from "@/hooks/use-session";

interface CredentialSummary {
  id: string;
  name: string;
  provider: string;
  authenticationType: string;
  status: "VALID" | "UNVERIFIED" | "INVALID" | "EXPIRED";
  maskedHint: string;
  lastValidatedAt: string | null;
}

export default function CredentialsPage() {
  const { currentOrganizationId } = useSession();
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ credentials: CredentialSummary[] }>("/api/credentials", {
        organizationId: currentOrganizationId,
      });
      setCredentials(res.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAction(action: "test" | "delete", id: string) {
    if (!currentOrganizationId) return;
    try {
      if (action === "test") {
        await apiRequest(`/api/credentials/${id}/test`, {
          method: "POST",
          organizationId: currentOrganizationId,
        });
      } else {
        await apiRequest(`/api/credentials/${id}`, {
          method: "DELETE",
          organizationId: currentOrganizationId,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Configuration</span>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Credentials</h1>
          <p className="mt-1 text-sm text-subink">
            Create a credential once, then reuse it across any Map Server or integration
            that needs it — never re-enter a secret.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "New credential"}</Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {showForm && (
        <CreateCredentialForm
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : credentials.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-subink">
            No credentials yet. Create one to start wiring up a Map Server or integration.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {credentials.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{c.name}</span>
                    <StatusBadge status={domainStatusMap.credentialStatus[c.status]}>
                      {c.status}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-subink">
                    <span>{c.provider}</span>
                    <span>{c.authenticationType}</span>
                    <span>{c.maskedHint}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handleAction("test", c.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleAction("delete", c.id)}>
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

function CreateCredentialForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const { currentOrganizationId } = useSession();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [authenticationType, setAuthenticationType] = useState<AuthenticationType>("API_KEY");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [customJson, setCustomJson] = useState("{\n  \n}");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrganizationId) return;
    setSubmitting(true);
    try {
      const payload =
        authenticationType === "CUSTOM" ? JSON.parse(customJson) : { ...fieldValues };
      await apiRequest("/api/credentials", {
        method: "POST",
        organizationId: currentOrganizationId,
        body: { name, provider, authenticationType, payload },
      });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to create credential — check the payload is valid JSON");
    } finally {
      setSubmitting(false);
    }
  }

  const fields = authenticationType === "CUSTOM" ? null : CREDENTIAL_FIELDS[authenticationType];

  return (
    <Card>
      <CardHeader>
        <CardTitle>New credential</CardTitle>
        <CardDescription>The secret is encrypted immediately and never shown again.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cred-name">Name</Label>
              <Input id="cred-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cred-provider">Provider</Label>
              <Input
                id="cred-provider"
                required
                placeholder="e.g. microsoft-fabric, aws, datadog"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-auth-type">Authentication type</Label>
            <Select
              id="cred-auth-type"
              value={authenticationType}
              onChange={(e) => {
                setAuthenticationType(e.target.value as AuthenticationType);
                setFieldValues({});
              }}
            >
              {AUTHENTICATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>

          {fields ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`cred-field-${f.key}`}>
                    {f.label}
                    {f.optional && <span className="text-subink"> (optional)</span>}
                  </Label>
                  <Input
                    id={`cred-field-${f.key}`}
                    type={f.secret ? "password" : "text"}
                    required={!f.optional}
                    value={fieldValues[f.key] ?? ""}
                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cred-custom-json">Fields (JSON)</Label>
              <Textarea
                id="cred-custom-json"
                rows={5}
                className="font-mono"
                value={customJson}
                onChange={(e) => setCustomJson(e.target.value)}
              />
            </div>
          )}

          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Creating…" : "Create credential"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
