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
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  resolutionMode: "OBSERVE_ONLY" | "RECOMMEND" | "HUMAN_APPROVED" | "AUTONOMOUS";
}

const CURRENT_ORG_STORAGE_KEY = "resolution.currentOrganizationId";

interface SessionContextValue {
  user: SessionUser | null;
  organizations: SessionOrganization[];
  currentOrganizationId: string | null;
  currentOrganization: SessionOrganization | null;
  loading: boolean;
  setCurrentOrganizationId: (id: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organizations, setOrganizations] = useState<SessionOrganization[]>([]);
  const [currentOrganizationId, setCurrentOrganizationIdState] = useState<string | null>(null);
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
      setCurrentOrganizationIdState(nextId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setOrganizations([]);
        setCurrentOrganizationIdState(null);
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

  const setCurrentOrganizationId = useCallback((id: string) => {
    setCurrentOrganizationIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, id);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOrganizations([]);
    setCurrentOrganizationIdState(null);
  }, []);

  const currentOrganization = useMemo(
    () => organizations.find((o) => o.id === currentOrganizationId) ?? null,
    [organizations, currentOrganizationId],
  );

  const value: SessionContextValue = {
    user,
    organizations,
    currentOrganizationId,
    currentOrganization,
    loading,
    setCurrentOrganizationId,
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
