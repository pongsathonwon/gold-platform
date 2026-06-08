import { zValidator } from "@hono/zod-validator";
import { loginSchema, registerSchema } from "@gold-platform/types";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { env } from "../lib/env.js";

const TOKEN_EXPIRY_SECONDS = 60 * 60; // 1 hour

function makeToken(userId: number, email: string) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;
  return sign({ sub: userId, email, exp }, env.JWT_SECRET, "HS256");
}

export const authRouter = new Hono()
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const { name, email, password } = c.req.valid("json");

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) return c.json({ error: "Email already in use" }, 409);

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash })
      .returning({ id: users.id, name: users.name, email: users.email });

    const token = await makeToken(user.id, user.email);
    return c.json({ token, user }, 201);
  })
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) return c.json({ error: "Invalid credentials" }, 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return c.json({ error: "Invalid credentials" }, 401);

    const token = await makeToken(user.id, user.email);
    return c.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  });
