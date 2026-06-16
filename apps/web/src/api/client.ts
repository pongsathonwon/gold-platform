import type { AppType } from "@gold-platform/api";
import { hc } from "hono/client";

const TOKEN_KEY = "gp_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export const client = hc<AppType>(import.meta.env.VITE_API_URL, {
  headers: () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});
