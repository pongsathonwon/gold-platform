import { jwt } from "hono/jwt";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { UserRole } from "../../db/schema/user.schema.js";

/**
 * The secret comes from the same validated config the rest of the app uses.
 *
 * It is read once at module load rather than through `AppConfig`, because Hono's `jwt()` helper
 * is not an Effect and this middleware is mounted at import time. The length check mirrors the
 * one in `env.ts` so a short secret fails here exactly as it would there — the alternative is a
 * server that boots happily and signs tokens with four characters of entropy.
 */
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("JWT_SECRET is not set, or is shorter than 32 characters");
}

export interface AuthClaims {
  sub: string;
  username: string;
  role: UserRole;
}

const verifySignature = jwt({ secret, alg: "HS256" });

export const authMiddleware = createMiddleware(async (c, next) => {
  // Hono's jwt middleware verifies the signature and populates `jwtPayload`, throwing an
  // HTTPException if the token is bad. Handing it a no-op `next` lets it return control here once
  // verification passes, so the claim check below runs before the route does.
  await verifySignature(c, async () => {});

  {
    /**
     * A token minted before `users.id` became a uuid carries a *number* in `sub`.
     *
     * Its signature is still valid, so nothing else would reject it — and the damage is quiet
     * rather than loud. `deactivateUserById` compares the target id against this claim to refuse
     * self-deactivation; a number never equals a uuid string, so the guard would silently stop
     * guarding and an admin could switch off their own account.
     *
     * Refused rather than coerced, on the same reasoning as the missing `role` claim below: a
     * claim that cannot be read must never be waved through, and the holder logs in again. Every
     * token expires within the hour anyway, so this is a one-off at deploy.
     */
    const sub = (c.get("jwtPayload") as { sub?: unknown } | undefined)?.sub;
    if (typeof sub !== "string") {
      return c.json({ error: "กรุณาเข้าสู่ระบบใหม่", code: "STALE_TOKEN" }, 401);
    }
  }

  await next();
});

/** The verified claims of the current request. Only valid downstream of `authMiddleware`. */
export function currentUser(c: Context): AuthClaims {
  return c.get("jwtPayload") as AuthClaims;
}

export function currentUsername(c: Context): string {
  return currentUser(c).username;
}

/**
 * Restricts a route to the listed roles. Mount *after* `authMiddleware` — it reads the claims that
 * middleware verified and does not itself check the signature.
 *
 * A token issued before the `role` claim existed has no role at all. That is treated as
 * insufficient rather than as a wildcard: an unreadable claim must never widen access, and the
 * holder simply logs in again to get a token that carries one.
 */
export const requireRole = (...allowed: UserRole[]) =>
  createMiddleware(async (c, next) => {
    const role = currentUser(c)?.role;
    if (!role || !allowed.includes(role)) {
      return c.json({ error: "insufficient permissions", code: "FORBIDDEN" }, 403);
    }
    await next();
  });
