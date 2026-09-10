"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "./nav-items";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, organizations, currentOrganizationId, currentOrganization, loading, logout, setCurrentOrganizationId } =
    useSession();

  const isNewOrgPage = pathname === "/dashboard/new-organization";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (organizations.length === 0 && !isNewOrgPage) {
      router.replace("/dashboard/new-organization");
    }
  }, [loading, user, organizations, isNewOrgPage, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-subink">
        Loading…
      </div>
    );
  }

  if (isNewOrgPage) {
    return <>{children}</>;
  }

  if (organizations.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-subink">
        Redirecting…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center border-b border-border px-4">
          <span className="font-display text-lg font-semibold text-navy">resolution</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            if (item.builtInPhase) {
              return (
                <span
                  key={item.href}
                  title={`Ships in Phase ${item.builtInPhase} — see IMPLEMENTATION_PLAN.md`}
                  className="flex cursor-not-allowed items-center justify-between rounded px-3 py-2 text-sm text-subink opacity-50"
                >
                  {item.label}
                  <span className="rounded-full bg-border px-1.5 py-0.5 font-mono text-[10px] text-subink">
                    soon
                  </span>
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-2 text-sm ${
                  isActive ? "bg-navy text-white" : "text-ink hover:bg-background"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <p className="truncate text-xs text-subink">{user.email}</p>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start px-0" onClick={() => void logout().then(() => router.push("/login"))}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
          <label className="flex items-center gap-2 text-sm text-subink">
            Organization
            <select
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-ink"
              value={currentOrganizationId ?? ""}
              onChange={(e) => setCurrentOrganizationId(e.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          {currentOrganization && (
            <span className="font-mono text-xs uppercase tracking-wide text-subink">
              {currentOrganization.role}
            </span>
          )}
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
