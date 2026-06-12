import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { UserManagementUseCase } from "../application/user.usecase.js";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { handleExit } from "../../../infrastructure/http/errors.js";

const userManager = new UserManagementUseCase(appRuntime);

const userDomainErrors = {
  UserNotFoundError: ["User not found", 404],
} as const;

export const usersRouter = new Hono()
  .get("/", async (c) => {
    const result = await userManager.findAllUser();
    return handleExit(c, result, (users) => c.json({ users }, 200));
  })
  .get("/:id", zValidator("param", z.coerce.number()), async (c) => {
    const result = await userManager.findUserById(c.req.valid("param"));
    return handleExit(c, result, (user) => c.json({ user }, 200), userDomainErrors);
  })
  .delete("/:id", zValidator("param", z.coerce.number()), async (c) => {
    const result = await userManager.deleteUserById(c.req.valid("param"));
    return handleExit(c, result, (user) => c.json({ user }, 200), userDomainErrors);
  });
