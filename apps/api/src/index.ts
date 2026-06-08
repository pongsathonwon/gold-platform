import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./infrastructure/env.js";
import { authRouter } from "./infrastructure/http/routes/auth.routes.js";
import { usersRouter } from "./infrastructure/http/routes/users.routes.js";

const app = new Hono()
  .use(logger())
  .use(cors({ origin: "http://localhost:5173" }))
  .route("/auth", authRouter)
  .route("/users", usersRouter);

export type AppType = typeof app;

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API running at http://localhost:${info.port}`);
});
