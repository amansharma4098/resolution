"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";

/**
 * Deliberately separate from /dashboard's layout — this is platform-level (every tenant at
 * once), not scoped to "the organization I currently have selected", so there's no
 * organization switcher here. Client-side gating is a UX convenience only; every actual
 * /api/platform/* route re-checks isSuperAdmin server-side regardless (see
 * apps/api/src/middleware/require-super-admin.ts) — this layout can't grant access on its
 * own, it can only hide the section from people who wouldn't be able to use it anyway.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.mustChangePassword) {
      router.replace("/change-password");
      return;
    }
    if (!user.isSuperAdmin) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  if (loading || !user || user.mustChangePassword || !user.isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-subink">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
        <div className="flex items-center gap-6">
          <span className="font-display text-lg font-semibold text-navy">resolution — Platform Admin</span>
          <Link href="/platform/tenants" className="text-sm text-ink hover:underline">
            Tenants
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-subink hover:underline">
            Back to my dashboard
          </Link>
          <Button variant="secondary" size="sm" onClick={() => void logout().then(() => router.replace("/login"))}>
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
