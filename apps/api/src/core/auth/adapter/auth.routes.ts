import { loginSchema, registerSchema } from "@gold-platform/types";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { AuthUseCase } from "../application/auth.usecase.js";
import { handleExit } from "../../../infrastructure/http/errors.js";
import { authMiddleware, requireRole } from "../../../infrastructure/http/middleware/auth.middleware.js";

const authUseCase = new AuthUseCase(appRuntime);

const authDomainErrors = {
  DuplicateEmailError: ["Username already in use", 409],
  InvalidCredentialsError: ["Invalid username or password", 401],
} as const;

export const authRouter = new Hono()
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const result = await authUseCase.login(c.req.valid("json"));
    return handleExit(c, result, (res) => c.json({ ...res }, 200), authDomainErrors);
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
