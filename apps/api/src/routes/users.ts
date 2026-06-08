import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";

export const usersRouter = new Hono()
  .get("/", async (c) => {
    const all = await db.select().from(users);
    return c.json(all);
  })
  .get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return c.json({ error: "Not found" }, 404);
    return c.json(user);
  })
  .delete("/:id", authMiddleware, async (c) => {
    const id = Number(c.req.param("id"));
    const [deleted] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning();
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json(deleted);
  });
