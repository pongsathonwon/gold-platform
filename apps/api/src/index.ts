import { serve } from "@hono/node-server";
import { Effect } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HttpConfig } from "./infrastructure/utils/env.js";
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

/**
 * Allowed browser origins, read at module load.
 *
 * The route tree has to be built at module scope so `AppType` can name it for the RPC client, and
 * `cors()` wants its origins when it is mounted — so this is read here rather than through the
 * Effect config layer, exactly as `JWT_SECRET` is in the auth middleware. `env.ts` validates the
 * same variable when the config layer builds, so a missing value still stops the server at boot
 * with a clear message.
 *
 * There is no default. The previous hard-coded `http://localhost:5173` meant the first real
 * deployment failed every preflight.
 */
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Liveness, for the platform rather than for a person.
 *
 * Deliberately does not touch the database. A health check that fails when Postgres blips tells
 * the orchestrator to kill and reschedule a process that is working fine and would recover on its
 * own, turning a brief database hiccup into a restart loop. This answers "is the HTTP server up",
 * which is the only question a liveness probe should ask — the connection is already proven at
 * startup by `healthCheck` in `db/client.ts`, before the server accepts any traffic.
 *
 * Mounted before CORS and before every authenticated router: a probe carries no Origin header and
 * no token.
 */
const app = new Hono()
  .get("/health", (c) => c.json({ status: "ok" }, 200))
  .use(logger())
  .use(cors({ origin: corsOrigins, credentials: true }))
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
  const config = yield* HttpConfig;

  const server = serve(
    // 0.0.0.0, not the default loopback: a container's port is reachable from outside only if the
    // process listens on every interface.
    { fetch: app.fetch, port: config.port, hostname: "0.0.0.0" },
    (info) => console.log(`API running on port ${info.port}`),
  );

  /**
   * Graceful shutdown.
   *
   * Cloud Run sends SIGTERM and waits before killing the container. With no handler the process
   * dies immediately: in-flight requests are dropped mid-transaction and the Postgres pool is
   * never closed, so connections linger on the database until they time out. Every deploy paid
   * that cost.
   *
   * Draining the HTTP server first and disposing the runtime second is the required order — the
   * runtime's finalizer closes the pool, and requests still finishing need it.
   */
  const shutdown = (signal: string) => {
    console.log(`${signal} received — draining`);
    server.close(async (err) => {
      if (err) console.error("error while draining:", err);
      await appRuntime.dispose();
      process.exit(err ? 1 : 0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});

appRuntime.runPromise(program).catch((err) => {
  console.error("Failed to initialize runtime:", err);
  process.exit(1);
});
