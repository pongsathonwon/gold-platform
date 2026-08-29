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
  /**
   * The port the HTTP server listens on. Defaulted, not required, and the default is never the
   * value in production.
   *
   * Cloud Run injects PORT into a *service* and expects the container to listen on it. It does not
   * inject it into a *job*, and it will not let you set it either — PORT is a reserved env name and
   * `run jobs update --set-env-vars=PORT=...` is rejected outright. So while this was required, any
   * job reaching for AppConfig died at boot with `Expected number, received nan`: the confirm sweep
   * needs the database, and the database lives behind the same config as the HTTP settings.
   *
   * Defaulting is safe precisely because a service always has the value injected, so the fallback
   * only ever applies where nothing listens on it.
   */
  PORT: z.coerce.number().default(3000),
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

/**
 * Parses `process.env` against a schema.
 *
 * Generic over the schema rather than over its result, because `z.Schema<T>` is
 * `ZodType<T, ZodTypeDef, T>` — it pins a schema's *input* type to its output type. Any schema
 * using `.default()` has an optional input and a required output, so inference collapsed the two
 * into the input and every defaulted field came back `T | undefined`. That made a Zod default
 * unusable here: the value was present at runtime and optional to the type checker.
 */
export const loadEnv = <S extends z.ZodTypeAny>(
  schema: S,
): Effect.Effect<z.output<S>, ConfigError> => {
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


