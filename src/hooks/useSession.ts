import { useAuth } from "@/lib/auth";

/**
 * Backwards-compatible wrapper around the single root-level AuthProvider.
 * Do not add another `onAuthStateChange` listener — use this hook instead.
 */
export function useSession() {
  const { session, user, initializing } = useAuth();
  return { session, user, loading: initializing };
}
