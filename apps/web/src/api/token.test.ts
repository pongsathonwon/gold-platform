import { describe, it, expect } from "vitest";
import { isTokenLive, tokenExpiresAt } from "./client";

/**
 * The client reads a token's own `exp` to know when to stop pretending it is signed in. It never
 * verifies — only the server can — so these cover the narrower question: is this still worth
 * sending, and does anything unreadable fail closed?
 */

// a JWT is three base64url segments; only the middle one is read here
const tokenWith = (payload: Record<string, unknown>) => {
  const encode = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature-not-checked`;
};

describe("tokenExpiresAt", () => {
  it("converts the exp claim from seconds to milliseconds", () => {
    expect(tokenExpiresAt(tokenWith({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it("returns null when there is no exp claim", () => {
    expect(tokenExpiresAt(tokenWith({ sub: 1 }))).toBeNull();
  });

  it("returns null rather than throwing on a malformed token", () => {
    expect(tokenExpiresAt("not-a-jwt")).toBeNull();
    expect(tokenExpiresAt("")).toBeNull();
    expect(tokenExpiresAt("a.!!!not-base64!!!.c")).toBeNull();
  });
});

describe("isTokenLive", () => {
  const inSeconds = (delta: number) => Math.floor(Date.now() / 1000) + delta;

  it("accepts a token that has not expired", () => {
    expect(isTokenLive(tokenWith({ exp: inSeconds(3600) }))).toBe(true);
  });

  // The whole point: the old guard was `!!token`, so an hour-old session stayed "signed in" while
  // every request 401'd.
  it("rejects an expired token", () => {
    expect(isTokenLive(tokenWith({ exp: inSeconds(-1) }))).toBe(false);
  });

  it("rejects an absent token", () => {
    expect(isTokenLive(null)).toBe(false);
  });

  // Fail closed: a token we cannot read is one we cannot use, and treating it as live would put
  // the app back into the state this exists to prevent.
  it("rejects a token with no readable expiry", () => {
    expect(isTokenLive(tokenWith({ sub: 1 }))).toBe(false);
    expect(isTokenLive("not-a-jwt")).toBe(false);
  });
});
