import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./lib/env.js";
import { usersRouter } from "./routes/users.js";

const app = new Hono()
  .use(logger())
  .use(cors({ origin: "http://localhost:5173" }))
  .route("/users", usersRouter);

// Export the app type for the Hono RPC client
export type AppType = typeof app;

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API running at http://localhost:${info.port}`);
});
