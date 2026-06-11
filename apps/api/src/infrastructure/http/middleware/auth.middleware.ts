import { jwt } from "hono/jwt";
import { createMiddleware } from "hono/factory";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is not set");

export const authMiddleware = createMiddleware(async (c, next) => {
  return jwt({ secret, alg: "HS256" })(c, next);
});
