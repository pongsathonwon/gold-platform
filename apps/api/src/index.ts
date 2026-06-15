import { serve } from "@hono/node-server";
import { Effect } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { AppConfig } from "./infrastructure/utils/env.js";
import { appRuntime } from "./infrastructure/runtime.js";
import { authRouter } from "./core/auth/adapter/auth.routes.js";
import { usersRouter } from "./core/user/adapter/user.routes.js";
import { masterDataRouter } from "./core/master/adapter/master-data.router.js";
import { inventoriesRoutes } from "./core/inventory/adapter/inventory.routes.js";
import { wholesaleSellRoutes } from "./core/wholesale-sell/adapter/wholesale-sell.routes.js";
import { wholesaleBuyRoutes } from "./core/wholesale-buy/adapter/wholesale-buy.routes.js";
import { retailBuyRoutes } from "./core/retail-buy/adapter/retail-buy.routes.js";
import { retailSellRoutes } from "./core/retail-sell/adapter/retail-sell.routes.js";
import { receiveRoutes } from "./core/receive/adapter/receive.routes.js";

const app = new Hono()
  .use(logger())
  .use(cors({ origin: "http://localhost:5173" }))
  .route("/auth", authRouter)
  .route("/users", usersRouter)
  .route("/master-data", masterDataRouter)
  .route("/inventory", inventoriesRoutes)
  .route("/wholesale-sell", wholesaleSellRoutes)
  .route("/wholesale-buy", wholesaleBuyRoutes)
  .route("/retail-buy", retailBuyRoutes)
  .route("/retail-sell", retailSellRoutes)
  .route("/receive", receiveRoutes)
  ;

export type AppType = typeof app;

const program = Effect.gen(function* () {
  const config = yield* AppConfig;
  serve({ fetch: app.fetch, port: config.app.port }, (info) => {
    console.log(`API running at http://localhost:${info.port}`);
  });
});

appRuntime.runPromise(program).catch((err) => {
  console.error("Failed to initialize runtime:", err);
  process.exit(1);
});
