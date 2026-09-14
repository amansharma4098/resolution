"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api-client";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  // Platform-level — see apps/api/src/middleware/require-super-admin.ts. Purely a UI hint
  // for whether to show the /platform section; every platform route re-checks this
  // server-side regardless, so there's no privilege in trusting this client-side.
  isSuperAdmin: boolean;
  // True when an admin set (or generated) this account's current password on the user's
  // behalf — gates a hard redirect to /change-password until they set their own.
  mustChangePassword: boolean;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  resolutionMode: "OBSERVE_ONLY" | "RECOMMEND" | "HUMAN_APPROVED" | "AUTONOMOUS";
}

const CURRENT_ORG_STORAGE_KEY = "resolution.currentTenantId";

interface SessionContextValue {
  user: SessionUser | null;
  organizations: SessionOrganization[];
  currentTenantId: string | null;
  currentOrganization: SessionOrganization | null;
  loading: boolean;
  setCurrentTenantId: (id: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organizations, setOrganizations] = useState<SessionOrganization[]>([]);
  const [currentTenantId, setCurrentTenantIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meRes = await apiRequest<{ user: SessionUser }>("/api/auth/me");
      setUser(meRes.user);

      const orgsRes = await apiRequest<{ organizations: SessionOrganization[] }>(
        "/api/organizations",
      );
      setOrganizations(orgsRes.organizations);

      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY) : null;
      const stillValid = orgsRes.organizations.some((o) => o.id === stored);
      const nextId = stillValid ? stored : (orgsRes.organizations[0]?.id ?? null);
      setCurrentTenantIdState(nextId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setOrganizations([]);
        setCurrentTenantIdState(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setCurrentTenantId = useCallback((id: string) => {
    setCurrentTenantIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, id);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOrganizations([]);
    setCurrentTenantIdState(null);
  }, []);

  const currentOrganization = useMemo(
    () => organizations.find((o) => o.id === currentTenantId) ?? null,
    [organizations, currentTenantId],
  );

  const value: SessionContextValue = {
    user,
    organizations,
    currentTenantId,
    currentOrganization,
    loading,
    setCurrentTenantId,
    refresh: load,
    logout,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
