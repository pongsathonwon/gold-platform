import { zValidator } from "@hono/zod-validator";
import { createUserSchema } from "@gold-platform/types";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

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
  .post("/", zValidator("json", createUserSchema), async (c) => {
    const body = c.req.valid("json");
    const [user] = await db.insert(users).values(body).returning();
    return c.json(user, 201);
  })
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [deleted] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning();
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json(deleted);
  });
