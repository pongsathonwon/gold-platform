import { Context, Data, Effect, } from "effect";
import { z } from "zod";

/**
 * Configuration is three tags, not one, because the workloads need different pieces of it.
 *
 * There used to be a single `AppConfig` carrying the HTTP settings, the database URL and the JWT
 * secret behind one Zod schema. Anything that touched *any* of it parsed *all* of it, so a
 * workload had to satisfy variables it never read. That was not a tidiness complaint:
 *
 *   - The confirm-sweep job needs the database and nothing else. It ran with `CORS_ORIGIN` and
 *     `JWT_SECRET` bound to it purely to get past the parser — a standing secret binding on a job
 *     that never mints or verifies a token.
 *   - Worse, `PORT` had to be given a default it should not need. Cloud Run injects PORT into a
 *     *service* but not into a *job*, and refuses to let you set it (`PORT` is a reserved name, so
 *     `run jobs update --set-env-vars=PORT=...` is rejected). While it was required, every job
 *     reaching for config died at boot with `Expected number, received nan`.
 *
 * Splitting them is what actually fixes that: a job builds `DatabaseConfig` alone and never looks
 * at an HTTP variable. The `PORT` default stays, because a default is right for a port anyway, but
 * it is no longer load-bearing.
 *
 * Each tag owns its own schema so the failure names the thing that is missing.
 */
export class DatabaseConfig extends Context.Tag("DatabaseConfig")<
  DatabaseConfig,
  { url: string }
>() { }

export class HttpConfig extends Context.Tag("HttpConfig")<
  HttpConfig,
  { port: number; corsOrigins: string[] }
>() { }

export class JwtConfig extends Context.Tag("JwtConfig")<
  JwtConfig,
  { secret: string }
>() { }

const databaseSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const httpSchema = z.object({
  /** Cloud Run injects this into a service. The default only ever applies where nothing listens. */
  PORT: z.coerce.number().default(3000),
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

const jwtSchema = z.object({
  JWT_SECRET: z.string().min(32),
});

export const makeDatabaseConfig = Effect.gen(function* () {
  const env = yield* loadEnv(databaseSchema);
  return { url: env["DATABASE_URL"] };
});

export const makeHttpConfig = Effect.gen(function* () {
  const env = yield* loadEnv(httpSchema);
  return {
    port: env["PORT"],
    corsOrigins: env["CORS_ORIGIN"].split(",").map((o) => o.trim()).filter(Boolean),
  };
});

export const makeJwtConfig = Effect.gen(function* () {
  const env = yield* loadEnv(jwtSchema);
  return { secret: env["JWT_SECRET"] };
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


