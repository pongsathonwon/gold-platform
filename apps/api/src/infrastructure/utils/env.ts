import { Context, Data, Effect, } from "effect";
import { z } from "zod";

interface ForSetupApp {
  app: {
    port: number;
    // exact origins allowed to call the API from a browser
    corsOrigins: string[];
  };
  database: {
    url: string;
  };
  jwt: {
    secret: string;
  };
}

export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  ForSetupApp
>() { }

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  // Cloud Run injects PORT and expects the container to listen on it; locally it comes from .env
  PORT: z.coerce.number(),
  JWT_SECRET: z.string().min(32),
  /**
   * Comma-separated list of browser origins allowed to call this API.
   *
   * Required, with no default. It used to be the string `http://localhost:5173` compiled into the
   * source, which meant the first real deployment failed every preflight. Making it configuration
   * with no fallback means the value is stated once per environment and a missing one stops the
   * server at boot rather than at the first request from a browser.
   */
  CORS_ORIGIN: z.string().min(1),
});

export const makeAppConfig = Effect.gen(function* () {
  const env = yield* loadEnv(envSchema);
  return {
    app: {
      port: env["PORT"],
      corsOrigins: env["CORS_ORIGIN"].split(",").map((o) => o.trim()).filter(Boolean),
    },
    database: {
      url: env["DATABASE_URL"],
    },
    jwt: {
      secret: env["JWT_SECRET"],
    },
  };
});

export class ConfigError extends Data.TaggedError("ConfigError")<{
  message: string;
  payload: z.ZodError;
}> { }

export const loadEnv = <T>(
  schema: z.Schema<T>,
): Effect.Effect<T, ConfigError> => {
  const result = schema.safeParse(process.env);
  return result.success
    ? Effect.succeed(result.data)
    : Effect.fail(
      new ConfigError({
        message: "[load config error]",
        payload: result.error,
      }),
    );
};


