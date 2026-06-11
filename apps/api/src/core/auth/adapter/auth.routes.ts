import { loginSchema, registerSchema } from "@gold-platform/types";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { Cause, Exit } from "effect";
import { AuthUseCase } from "../application/auth.usecase.js";

const authUseCase = new AuthUseCase(appRuntime);

export const authRouter = new Hono()
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const req = c.req.valid('json');
    const result = await authUseCase.register(req);

    return Exit.match(result, {
      onSuccess: (res) => c.json({ ...res }, 201),
      onFailure: (cause) => {
        if (!Cause.isFailType(cause)) {
          return c.json({ error: 'internal server error' }, 500)
        }
        switch (cause.error._tag) {
          case "DatabaseConnectionError": return c.json({ error: 'db connection error' }, 500)
          case "DrizzleInitializeError": return c.json({ error: 'drizzle error' }, 500)
          case "UnknownException": return c.json({ error: 'internal server error' }, 500)
          case "ConfigError": return c.json({ error: 'cannot load config error' }, 500)
          case "RepositoryError": return c.json({ error: 'internal server error' }, 500)
          case "DuplicateEmailError": return c.json({ error: 'email already in use' }, 409)
        }
      }
    })
  })
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const req = c.req.valid('json');
    const result = await authUseCase.login(req);

    return Exit.match(result, {
      onSuccess: (res) => c.json({ ...res }, 200),
      onFailure: (cause) => {
        if (!Cause.isFailType(cause)) {
          return c.json({ error: 'internal server error' }, 500)
        }
        switch (cause.error._tag) {
          case "DatabaseConnectionError": return c.json({ error: 'db connection error' }, 500)
          case "DrizzleInitializeError": return c.json({ error: 'drizzle error' }, 500)
          case "UnknownException": return c.json({ error: 'internal server error' }, 500)
          case "ConfigError": return c.json({ error: 'cannot load config error' }, 500)
          case "RepositoryError": return c.json({ error: 'internal server error' }, 500)
          case "InvalidCredentialsError": return c.json({ error: 'invalid email or password' }, 401)
        }
      }
    })
  });
