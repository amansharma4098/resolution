"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
}

export default function SettingsPage() {
  const { currentOrganization, currentOrganizationId, user } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newAccountNotice, setNewAccountNotice] = useState<{ email: string; password: string } | null>(
    null,
  );

  const canManage = currentOrganization?.role === "OWNER" || currentOrganization?.role === "ADMIN";

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ members: Member[] }>("/api/organizations/members", {
        organizationId: currentOrganizationId,
      });
      setMembers(res.members);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load team members");
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRoleChange(userId: string, role: Role) {
    if (!currentOrganizationId) return;
    try {
      await apiRequest(`/api/organizations/members/${userId}`, {
        method: "PATCH",
        organizationId: currentOrganizationId,
        body: { role },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change role");
    }
  }

  async function handleRemove(userId: string) {
    if (!currentOrganizationId) return;
    try {
      await apiRequest(`/api/organizations/members/${userId}`, {
        method: "DELETE",
        organizationId: currentOrganizationId,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Settings</span>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Team</h1>
          <p className="mt-1 text-sm text-subink">
            {currentOrganization?.name} — every teammate belongs to this organization only;
            there is no self-serve way to join it. An OWNER or ADMIN adds people here.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add teammate"}</Button>
        )}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {newAccountNotice && (
        <Card emphasized>
          <CardContent className="py-4">
            <p className="text-sm text-white">
              Account created for <span className="font-medium">{newAccountNotice.email}</span>. Share
              this temporary password with them — it won&apos;t be shown again:
            </p>
            <p className="mt-2 rounded bg-white/10 px-3 py-2 font-mono text-sm text-white">
              {newAccountNotice.password}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => setNewAccountNotice(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <AddMemberForm
          onAdded={(notice) => {
            setShowForm(false);
            if (notice) setNewAccountNotice(notice);
            void load();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : (
        <div className="grid gap-3">
          {members.map((m) => (
            <Card key={m.userId}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{m.name ?? m.email}</span>
                    {m.userId === user?.id && <StatusBadge status="info">You</StatusBadge>}
                  </div>
                  <span className="text-sm text-subink">{m.email}</span>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      onChange={(e) => void handleRoleChange(m.userId, e.target.value as Role)}
                      className="w-32"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="danger" onClick={() => void handleRemove(m.userId)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <span className="font-mono text-xs uppercase text-subink">{m.role}</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddMemberForm({
  onAdded,
  onError,
}: {
  onAdded: (notice: { email: string; password: string } | null) => void;
  onError: (msg: string) => void;
}) {
  const { currentOrganizationId } = useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrganizationId) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ member: Member; temporaryPassword?: string }>(
        "/api/organizations/members",
        {
          method: "POST",
          organizationId: currentOrganizationId,
          body: { email, name: name || undefined, role },
        },
      );
      onAdded(res.temporaryPassword ? { email, password: res.temporaryPassword } : null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to add teammate");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a teammate</CardTitle>
        <CardDescription>
          If this email doesn&apos;t have an account yet, one is created with a one-time
          temporary password. If it does, they&apos;re just added to this organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-email">Email</Label>
              <Input id="member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-name">Name (optional)</Label>
              <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-role">Role</Label>
              <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Adding…" : "Add teammate"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
