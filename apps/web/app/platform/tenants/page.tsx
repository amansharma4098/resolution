"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@resolution/ui";

// resolutionMode isn't one of domainStatusMap's existing categories (those are incident/
// connection/policy/credential status) — a small local map instead of forcing a mismatch.
const RESOLUTION_MODE_COLOR: Record<string, "success" | "warning" | "error" | "critical" | "info" | "neutral"> = {
  OBSERVE_ONLY: "neutral",
  RECOMMEND: "info",
  HUMAN_APPROVED: "warning",
  AUTONOMOUS: "success",
};
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiRequest } from "@/lib/api-client";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  resolutionMode: string;
  memberCount: number;
  incidentCount: number;
  createdAt: string;
}

interface CreateTenantResponse {
  organization: Tenant;
  admin: { email: string; name: string | null };
  temporaryPassword?: string;
}

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState<CreateTenantResponse | null>(null);

  const [orgName, setOrgName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ tenants: Tenant[] }>("/api/platform/tenants");
      setTenants(res.tenants);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const res = await apiRequest<CreateTenantResponse>("/api/platform/tenants", {
          method: "POST",
          body: { organizationName: orgName, adminEmail, adminName: adminName || undefined },
        });
        setJustCreated(res);
        setCopied(false);
        setOrgName("");
        setAdminEmail("");
        setAdminName("");
        setShowForm(false);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to create tenant");
      } finally {
        setSubmitting(false);
      }
    },
    [orgName, adminEmail, adminName, load],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Platform</span>
          <h1 className="font-display text-2xl font-semibold text-ink">Tenants</h1>
          <p className="mt-1 text-sm text-subink">
            Every organization on the platform — provisioning a tenant here creates it and its admin user in one
            step, the sales-assisted onboarding path alongside self-serve signup.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New tenant"}</Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {justCreated?.temporaryPassword && (
        <Card className="border-navy">
          <CardHeader>
            <CardTitle>Tenant created — save this password now</CardTitle>
            <CardDescription>
              Shown only this once. Relay it to {justCreated.admin.email} — they should change it on first login.
              It&apos;s a long random string — copy it rather than retyping it, a dropped character reads back as
              &quot;incorrect password&quot; with no other hint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-background p-2">
              <p className="break-all font-mono text-sm text-ink">
                {justCreated.admin.email} / {justCreated.temporaryPassword}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(justCreated.temporaryPassword!);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied ✓" : "Copy password"}
              </Button>
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setJustCreated(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Provision a new tenant</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="orgName">Organization name</Label>
                <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="adminEmail">Admin email</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                />
                <p className="mt-1 text-xs text-subink">
                  If this email already has an account, they&apos;re just added as this tenant&apos;s owner — no new
                  password.
                </p>
              </div>
              <div>
                <Label htmlFor="adminName">Admin name (optional)</Label>
                <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create tenant"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tenants.length} tenant{tenants.length === 1 ? "" : "s"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-subink">Loading…</p>
          ) : tenants.length === 0 ? (
            <p className="text-sm text-subink">No tenants yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tenants.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{t.name}</span>
                      <span className="font-mono text-xs text-subink">/{t.slug}</span>
                    </div>
                    <p className="text-xs text-subink">
                      {t.memberCount} member{t.memberCount === 1 ? "" : "s"} · {t.incidentCount} incident
                      {t.incidentCount === 1 ? "" : "s"} · created {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={RESOLUTION_MODE_COLOR[t.resolutionMode] ?? "neutral"}>
                    {t.resolutionMode}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
