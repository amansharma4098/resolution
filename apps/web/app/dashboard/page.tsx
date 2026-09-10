"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/hooks/use-session";

export default function DashboardPage() {
  const { currentOrganization } = useSession();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Dashboard</span>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {currentOrganization?.name ?? "Your organization"}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nothing to show yet</CardTitle>
          <CardDescription>
            Incident metrics, active investigations and recent resolutions will appear here
            once you connect an incident source and a Map Server. That configuration flow
            (Credentials → Map Servers → Integrations) ships in Phase 2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subink">
            Your organization, membership and role are live and enforced end to end — see{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
              IMPLEMENTATION_PLAN.md
            </code>{" "}
            for what&apos;s next.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
