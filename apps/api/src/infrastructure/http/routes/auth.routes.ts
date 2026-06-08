import { zValidator } from "@hono/zod-validator";
import { loginSchema, registerSchema } from "@gold-platform/types";
import { Hono } from "hono";
import { loginUseCase } from "../../../application/auth/login.usecase.js";
import { registerUseCase } from "../../../application/auth/register.usecase.js";
import { DrizzleUserRepository } from "../../db/repositories/drizzle-user.repository.js";
import { env } from "../../env.js";

const repo = new DrizzleUserRepository();

export const authRouter = new Hono()
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const body = c.req.valid("json");
    try {
      const result = await registerUseCase(repo, body, env.JWT_SECRET);
      return c.json(result, 201);
    } catch (e: any) {
      if (e.code === "EMAIL_TAKEN") return c.json({ error: "Email already in use" }, 409);
      throw e;
    }
  })
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const body = c.req.valid("json");
    try {
      const result = await loginUseCase(repo, body, env.JWT_SECRET);
      return c.json(result);
    } catch (e: any) {
      if (e.code === "INVALID_CREDENTIALS") return c.json({ error: "Invalid credentials" }, 401);
      throw e;
    }
  });
