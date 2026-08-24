import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicUser, UserRoleValue } from "@gold-platform/types";
import {
  client, getToken, setToken, clearToken, getStoredUser, setStoredUser, isTokenLive,
  setUnauthorizedHandler, tokenExpiresAt,
} from "../api/client";

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  isAuthenticated: boolean;
  /** The signed-in user's role, or null when signed out. */
  role: UserRoleValue | null;
  /**
   * Whether this user may perform the operations the API restricts to ADMIN — the manual
   * inventory adjustments and the bulk confirm sweeps.
   *
   * This decides what the UI *offers*, never what is *allowed*: the server re-checks the token's
   * own role claim on every call. Hiding a control the API would refuse is a courtesy to the
   * operator, not a security boundary.
   */
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** True when a session ended on its own rather than by the user signing out. */
  sessionExpired: boolean;
  clearSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // An expired token in storage is not a session. Checking at init is what stops the app booting
  // straight into a dashboard whose every request will 401.
  const [tokenState, setTokenState] = useState<string | null>(() => {
    const stored = getToken();
    if (isTokenLive(stored)) return stored;
    clearToken();
    return null;
  });
  const [user, setUser] = useState<PublicUser | null>(() =>
    isTokenLive(getToken()) ? getStoredUser() : null,
  );
  const [sessionExpired, setSessionExpired] = useState(false);

  const endSession = useCallback(
    (expired: boolean) => {
      clearToken();
      setTokenState(null);
      setUser(null);
      if (expired) setSessionExpired(true);
      // Cached responses belong to the account that fetched them. Leaving them would show the
      // next person to sign in the previous one's data until each query refetched.
      queryClient.clear();
    },
    [queryClient],
  );

  // A 401 from anywhere means the token is no longer accepted, whatever its own `exp` claims —
  // the secret could have been rotated, or the account removed.
  useEffect(() => {
    setUnauthorizedHandler(() => endSession(true));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  /**
   * Expire the session on a timer as well as on a 401.
   *
   * A rejected request is only discovered when something asks for one. An operator who steps away
   * mid-shift should come back to a login screen, not to a stale page that fails the moment they
   * touch it.
   */
  useEffect(() => {
    if (!tokenState) return;

    const expiresAt = tokenExpiresAt(tokenState);
    if (expiresAt === null) return;

    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      endSession(true);
      return;
    }

    // setTimeout clamps above ~24.8 days; a one-hour token is nowhere near that, and a token
    // claiming to last longer simply gets caught by the 401 handler instead.
    const timer = setTimeout(() => endSession(true), remaining);
    return () => clearTimeout(timer);
  }, [tokenState, endSession]);

  async function login(username: string, password: string) {
    const res = await client.auth.login.$post({ json: { username, password } });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : "Login failed";
      throw new Error(message);
    }
    const body = (await res.json()) as { token: string; user: PublicUser };
    setToken(body.token);
    setStoredUser(body.user);
    setTokenState(body.token);
    setUser(body.user);
    setSessionExpired(false);
  }

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.role ?? null;
    return {
      user,
      token: tokenState,
      isAuthenticated: !!tokenState,
      role,
      isAdmin: role === "ADMIN",
      login,
      logout: () => endSession(false),
      sessionExpired,
      clearSessionExpired: () => setSessionExpired(false),
    };
    // `login` is stable enough for this memo — it closes over nothing that changes per render
    // except the setters, which React guarantees are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tokenState, sessionExpired, endSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
