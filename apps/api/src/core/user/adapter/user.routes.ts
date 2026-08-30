import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { UserManagementUseCase } from "../application/user.usecase.js";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { handleExit } from "../../../infrastructure/http/errors.js";
import { authMiddleware, currentUser, requireRole } from "../../../infrastructure/http/middleware/auth.middleware.js";
import { toPublicUser } from "../domain/user.entity.js";

const userManager = new UserManagementUseCase(appRuntime);

const userDomainErrors = {
  UserNotFoundError: ["User not found", 404],
  CannotDeactivateSelfError: ["คุณไม่สามารถปิดใช้งานบัญชีของตัวเองได้", 422],
  LastAdminError: ["ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อยหนึ่งบัญชี", 422],
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
  .get("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const result = await userManager.findUserById(c.req.valid("param").id);
    return handleExit(c, result, (user) => c.json({ data: toPublicUser(user) }, 200), userDomainErrors);
  })
  /**
   * Deactivates an account. Kept on DELETE because that is the intent a caller expresses — the row
   * survives, but the login does not, and no client should have to know which.
   *
   * The actor comes from the verified token, never from the request, so the self-deactivation guard
   * cannot be talked out of by the caller it applies to.
   */
  .delete("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const result = await userManager.deactivateUserById(c.req.valid("param").id, currentUser(c).sub);
    return handleExit(c, result, (user) => c.json({ data: toPublicUser(user) }, 200), userDomainErrors);
  })
  /** Undoes a deactivation. Its own verb because restoring is not deleting less. */
  .post("/:id/restore", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const result = await userManager.restoreUserById(c.req.valid("param").id);
    return handleExit(c, result, (user) => c.json({ data: toPublicUser(user) }, 200), userDomainErrors);
  });
