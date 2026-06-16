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
  const [token, setTokenState] = useState<string | null>(getToken());
  const [user, setUser] = useState<PublicUser | null>(null);

  async function login(username: string, password: string) {
    const res = await client.auth.login.$post({ json: { username, password } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body as { error?: string } | null)?.error ?? "Login failed");
    }
    const body = await res.json();
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
      value={{ user, token, isAuthenticated: !!token, login, logout }}
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
