"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiRequest } from "@/lib/api-client";

interface ApiKey {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ apiKeys: ApiKey[] }>("/api/api-keys");
      setKeys(res.apiKeys);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string }>("/api/api-keys", { method: "POST", body: { name } });
      setRevealedToken(res.token);
      setCopied(false);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create API key");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await apiRequest(`/api/api-keys/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke key");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Personal</span>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">API Keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-subink">
          Long-lived credentials for a caller that can&apos;t hold your browser session — today,
          that means this platform&apos;s own MCP server: point Claude Desktop or another MCP
          client at{" "}
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">/api/mcp</code>{" "}
          with one of these as a bearer token (see <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">docs/mcp-server.md</code>)
          to ask about incidents from your own tools. Personal to you, not tied to one
          organization — every tool call still checks you&apos;re actually a member of
          whichever organization it names.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {revealedToken && (
        <Card emphasized>
          <CardContent className="py-4">
            <p className="text-sm text-white">
              Copy this key now — it won&apos;t be shown again.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-white/10 px-3 py-2">
              <span className="break-all font-mono text-sm text-white">{revealedToken}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(revealedToken);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </Button>
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRevealedToken(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create a new key</CardTitle>
          <CardDescription>Name it after where it&apos;ll be used, so you can tell keys apart later.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                required
                placeholder="e.g. Claude Desktop"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create key"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-subink">No API keys yet.</p>
      ) : (
        <div className="grid gap-3">
          {keys.map((key) => (
            <Card key={key.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-ink">{key.name}</span>
                  <span className="text-xs text-subink">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt && ` — last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                    {key.revokedAt && " — revoked"}
                  </span>
                </div>
                {!key.revokedAt && (
                  <Button size="sm" variant="danger" onClick={() => void handleRevoke(key.id)}>
                    Revoke
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
