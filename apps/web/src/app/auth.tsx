import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const STORAGE_KEY = "orbis.auth.session.v1";

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
}

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  configured: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = Boolean(supabaseUrl && anonKey);

  const saveSession = useCallback((next: AuthSession | null) => {
    setSession(next);
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshSession = useCallback(async (current: AuthSession) => {
    if (!supabaseUrl || !anonKey) throw new Error("Supabase is not configured");
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    if (!response.ok) throw new Error("Your session expired. Sign in again.");
    const body = await response.json();
    const next = normalizeSession(body);
    saveSession(next);
    return next;
  }, [saveSession]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AuthSession;
        if (parsed.access_token && parsed.refresh_token && parsed.user?.id) setSession(parsed);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setLoading(false);
  }, [configured]);

  useEffect(() => {
    if (!session || !configured) return;
    const delay = Math.max(1_000, session.expires_at * 1_000 - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void refreshSession(session).catch(() => saveSession(null));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [session, configured, refreshSession, saveSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabaseUrl || !anonKey) throw new Error("Supabase is not configured");
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body?.msg === "string" ? body.msg : "Sign-in failed.");
    saveSession(normalizeSession(body));
  }, [saveSession]);

  const value = useMemo(() => ({
    session,
    loading,
    configured,
    signIn,
    signOut: () => saveSession(null),
  }), [session, loading, configured, signIn, saveSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

function normalizeSession(value: Record<string, unknown>): AuthSession {
  const user = value.user as Record<string, unknown> | undefined;
  if (typeof value.access_token !== "string" || typeof value.refresh_token !== "string" || typeof user?.id !== "string") {
    throw new Error("Supabase returned an invalid session.");
  }
  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: { id: user.id, ...(typeof user.email === "string" ? { email: user.email } : {}) },
  };
}
