import { createContext, useContext, useState, type ReactNode } from "react";
import type { PublicUser } from "@gold-platform/types";
import { client, getToken, setToken, clearToken } from "../api/client";

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokenState, setTokenState] = useState<string | null>(getToken);
  const [user, setUser] = useState<PublicUser | null>(null);

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
    setTokenState(body.token);
    setUser(body.user);
  }

  function logout() {
    clearToken();
    setTokenState(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token: tokenState,
        isAuthenticated: !!tokenState,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
