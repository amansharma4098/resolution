"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

export default function NewOrganizationPage() {
  const router = useRouter();
  const { refresh, setCurrentOrganizationId } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ organization: { id: string } }>("/api/organizations", {
        method: "POST",
        body: { name },
      });
      await refresh();
      setCurrentOrganizationId(res.organization.id);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>
            This is the workspace your team, credentials and incidents live in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                required
                placeholder="Acme Corp"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
