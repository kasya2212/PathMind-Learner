import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthValue = {
  session: Session | null;
  user: User | null;
  /** True until the persisted session has been read once. Never redirect while true. */
  initializing: boolean;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  user: null,
  initializing: true,
});

/**
 * Single source of truth for auth state.
 *
 * One listener for the whole app: mounted at the root so navigating between
 * routes never remounts it and never re-triggers a "no session yet" flash.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // Register the listener FIRST so no event fired during hydration is missed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted.current) return;
      // TOKEN_REFRESHED / USER_UPDATED carry a session too — just take it.
      // Only an explicit SIGNED_OUT clears the session.
      if (event === "SIGNED_OUT") {
        setSession(null);
      } else if (next) {
        setSession(next);
      }
      setInitializing(false);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted.current) return;
        setSession((current) => current ?? data.session);
        setInitializing(false);
      })
      .catch(() => {
        // A transient network failure must not look like "signed out".
        if (mounted.current) setInitializing(false);
      });

    return () => {
      mounted.current = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ session, user: session?.user ?? null, initializing }),
    [session, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
