import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { UserManagementUseCase } from "../application/user.usecase.js";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { handleExit } from "../../../infrastructure/http/errors.js";
import { authMiddleware, requireRole } from "../../../infrastructure/http/middleware/auth.middleware.js";
import { toPublicUser } from "../domain/user.entity.js";

const userManager = new UserManagementUseCase(appRuntime);

const userDomainErrors = {
  UserNotFoundError: ["User not found", 404],
} as const;

/**
 * User administration. Every route here requires an authenticated `ADMIN`.
 *
 * The whole router was previously unauthenticated: `GET /users` returned full rows — password
 * hashes included — to any anonymous caller, and `DELETE /users/:id` would remove any account on
 * request. Responses now go through `toPublicUser`, so the hash cannot escape even if a future
 * column is added to the row.
 */
export const usersRouter = new Hono()
  .use(authMiddleware)
  .use(requireRole("ADMIN"))
  .get("/", async (c) => {
    const result = await userManager.findAllUser();
    return handleExit(c, result, (users) => c.json({ data: users.map(toPublicUser) }, 200));
  })
  .get("/:id", zValidator("param", z.object({ id: z.coerce.number() })), async (c) => {
    const result = await userManager.findUserById(c.req.valid("param").id);
    return handleExit(c, result, (user) => c.json({ data: toPublicUser(user) }, 200), userDomainErrors);
  })
  .delete("/:id", zValidator("param", z.object({ id: z.coerce.number() })), async (c) => {
    const result = await userManager.deleteUserById(c.req.valid("param").id);
    return handleExit(c, result, (user) => c.json({ data: toPublicUser(user) }, 200), userDomainErrors);
  });
