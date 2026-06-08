import { jwt } from "hono/jwt";
import { env } from "../lib/env.js";

export const authMiddleware = jwt({ secret: env.JWT_SECRET, alg: "HS256" });
