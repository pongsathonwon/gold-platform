import { loginSchema, registerSchema } from "@gold-platform/types";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { Cause, Exit } from "effect";
import { clientAddress, FailureRateLimiter } from "../../../infrastructure/http/rate-limit.js";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { AuthUseCase } from "../application/auth.usecase.js";
import { handleExit } from "../../../infrastructure/http/errors.js";
import { authMiddleware, requireRole } from "../../../infrastructure/http/middleware/auth.middleware.js";

const authUseCase = new AuthUseCase(appRuntime);

const authDomainErrors = {
  DuplicateEmailError: ["Username already in use", 409],
  InvalidCredentialsError: ["Invalid username or password", 401],
} as const;

/** True only when the login was refused for the credential itself, not for an infrastructure fault. */
const isInvalidCredentials = (exit: Exit.Exit<unknown, { _tag: string }>): boolean =>
  Exit.isFailure(exit)
  && Cause.isFailType(exit.cause)
  && exit.cause.error._tag === "InvalidCredentialsError";

/**
 * Ceilings on password guessing. Two keys, because they defend against different attacks.
 *
 * The **username** limit is the one that protects an account: a caller cannot lie about which
 * account they are guessing at, so this holds however many addresses they come from. It is set low.
 *
 * The **address** limit catches spraying — many usernames, few attempts each — which the username
 * counter never sees. It is set high on purpose. A branch behind one NAT shares an address, so a
 * tight limit here would lock out a whole shop because two people mistyped in the same quarter of
 * an hour, and an outage nobody can explain is worse than the attack.
 *
 * Both count failures only and both are cleared by a success, so ordinary use never approaches them.
 */
const WINDOW_MS = 15 * 60 * 1000;
const byUsername = new FailureRateLimiter({ max: 8, windowMs: WINDOW_MS });
const byAddress = new FailureRateLimiter({ max: 40, windowMs: WINDOW_MS });

export const authRouter = new Hono()
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { username } = c.req.valid("json");
    // Case-folded so `Admin` and `admin` cannot be guessed at as two separate budgets.
    const userKey = username.toLowerCase();
    const addressKey = clientAddress(c.req.header("x-forwarded-for"));

    for (const [limiter, key] of [[byUsername, userKey], [byAddress, addressKey]] as const) {
      const decision = limiter.check(key);
      if (!decision.allowed) {
        // 429 rather than 401: the caller is being told to stop, not that the password was wrong.
        // It reveals nothing either way — the same answer comes back for an account that does not
        // exist, because the counter is keyed on what was typed rather than on what was found.
        return c.json(
          { error: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่", code: "TOO_MANY_ATTEMPTS" },
          429,
          { "Retry-After": String(decision.retryAfterSeconds) },
        );
      }
    }

    const result = await authUseCase.login(c.req.valid("json"));

    /**
     * Only a rejected credential counts against the budget — not a database outage.
     *
     * Counting every non-success would mean an unreachable database burns through every user's
     * allowance in a few refreshes, so the shop stays locked out for fifteen minutes *after* the
     * database comes back. The failure this limiter exists for is someone guessing, and that is
     * exactly `InvalidCredentialsError`.
     */
    if (isInvalidCredentials(result)) {
      byUsername.recordFailure(userKey);
      byAddress.recordFailure(addressKey);
    }

    return handleExit(
      c,
      result,
      (res) => {
        // A success clears the username's budget, so a run of typos before finally getting it right
        // costs nothing. The address budget is left alone: one valid login should not wipe the
        // record of failures against every other account tried from there.
        byUsername.clear(userKey);
        return c.json({ ...res }, 200);
      },
      authDomainErrors,
    );
  })
  /**
   * Creating a login, admin-only.
   *
   * This replaced a public `POST /auth/register`. On a system where an account can move gold and
   * write off stock, self-service signup meant anyone who could reach the API could grant
   * themselves the run of the vault. Accounts are issued by someone accountable for issuing them.
   *
   * It returns the created user and no token — the admin keeps their own session.
   */
  .post(
    "/users",
    authMiddleware,
    requireRole("ADMIN"),
    zValidator("json", registerSchema),
    async (c) => {
      const result = await authUseCase.createUser(c.req.valid("json"));
      return handleExit(c, result, (user) => c.json({ data: user }, 201), authDomainErrors);
    },
  );
