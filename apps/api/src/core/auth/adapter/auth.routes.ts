import { loginSchema, registerSchema } from "@gold-platform/types";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { AuthUseCase } from "../application/auth.usecase.js";
import { handleExit } from "../../../infrastructure/http/errors.js";

const authUseCase = new AuthUseCase(appRuntime);

const authDomainErrors = {
  DuplicateEmailError: ["Email already in use", 409],
  InvalidCredentialsError: ["Invalid email or password", 401],
} as const;

export const authRouter = new Hono()
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const result = await authUseCase.register(c.req.valid("json"));
    return handleExit(c, result, (res) => c.json({ ...res }, 201), authDomainErrors);
  })
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const result = await authUseCase.login(c.req.valid("json"));
    return handleExit(c, result, (res) => c.json({ ...res }, 200), authDomainErrors);
  });
