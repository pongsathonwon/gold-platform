import { Hono } from "hono";
import { deleteUserUseCase } from "../../../application/user/delete-user.usecase.js";
import { getUserUseCase } from "../../../application/user/get-user.usecase.js";
import { getUsersUseCase } from "../../../application/user/get-users.usecase.js";
import { DrizzleUserRepository } from "../../db/repositories/drizzle-user.repository.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const repo = new DrizzleUserRepository();

export const usersRouter = new Hono()
  .get("/", async (c) => {
    const users = await getUsersUseCase(repo);
    return c.json(users);
  })
  .get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const user = await getUserUseCase(repo, id);
    if (!user) return c.json({ error: "Not found" }, 404);
    return c.json(user);
  })
  .delete("/:id", authMiddleware, async (c) => {
    const id = Number(c.req.param("id"));
    const deleted = await deleteUserUseCase(repo, id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json(deleted);
  });
