import type { AppType } from "@gold-platform/api";
import type { PublicUser } from "@gold-platform/types";
import { hc } from "hono/client";

const TOKEN_KEY = "gp_token";
const USER_KEY = "gp_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * The signed-in user, kept beside the token.
 *
 * Previously only the token survived a reload, so `user` came back `null` and nothing downstream
 * could ask who was signed in — which matters now that the answer decides what the UI offers.
 * This is a cache of what the token already asserts, not a second source of truth: the server
 * authorises off the token's own `role` claim and ignores anything stored here.
 */
export function getStoredUser(): PublicUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublicUser;
  } catch {
    // a corrupt entry is not worth a crash on boot — treat it as absent
    return null;
  }
}

export function setStoredUser(user: PublicUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * When a token stops being accepted, in ms since the epoch — read from its own `exp` claim.
 *
 * The payload is decoded, never verified: only the server can verify it, and the client does not
 * need to. The question here is narrower — "is it still worth sending?" — and answering it is what
 * keeps an expired session from looking like a broken app. Anything unparseable is reported as
 * expired, because a token we cannot read is one we cannot use.
 */
export function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Whether a token is present, readable, and not past its own expiry. */
export function isTokenLive(token: string | null): token is string {
  if (!token) return false;
  const expiresAt = tokenExpiresAt(token);
  return expiresAt !== null && expiresAt > Date.now();
}

/**
 * What to do when the server rejects our credentials.
 *
 * Registered by `AuthProvider` at mount. A module-level slot rather than context because the
 * fetch wrapper below is built once, at module scope, outside React — and the alternative
 * (threading a client instance through providers) buys nothing.
 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

/** Thrown on a 401 so callers can tell "your session ended" from "that request failed". */
export class UnauthorizedError extends Error {
  constructor() {
    super("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    this.name = "UnauthorizedError";
  }
}

/**
 * Every request goes through here so a 401 is handled once, centrally.
 *
 * Without it an expired token produced a page of red "โหลดข้อมูลไม่สำเร็จ" alerts and no way back
 * to the login screen — the guard only ever checked that *some* token existed, so the app stayed
 * convinced it was signed in while every call failed.
 */
const authFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401) onUnauthorized?.();
  return res;
};

export const client = hc<AppType>(import.meta.env.VITE_API_URL, {
  fetch: authFetch,
  headers: (): Record<string, string> => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});

/**
 * Turns a failed response into the right thrown error, and reads the API's `{ error }` body for
 * the message so the operator sees what the server actually said rather than a generic string.
 *
 * Every query and mutation goes through this. It was three separate copies of `parseErrorMessage`
 * before, none of which distinguished a 401 — so an expired session surfaced as an ordinary
 * failure and got retried three times.
 *
 * `fallback` is used only when the body carries no message of its own.
 */
export async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  if (res.status === 401) throw new UnauthorizedError();

  const body: unknown = await res.json().catch(() => null);
  const message =
    typeof body === "object" && body !== null && "error" in body
      ? String((body as { error: unknown }).error)
      : fallback;

  if (res.status === 403) {
    // The API refused on role, not on identity. Saying so is the difference between "you cannot
    // do this" and "something went wrong", and only one of them tells the operator what to do.
    throw new Error(message === fallback ? "คุณไม่มีสิทธิ์ทำรายการนี้" : message);
  }
  throw new Error(message);
}
