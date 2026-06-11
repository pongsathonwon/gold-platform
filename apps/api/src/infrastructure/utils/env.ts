import { Context, Data, Effect, } from "effect";
import { z } from "zod";

interface ForSetupApp {
  app: {
    port: number;
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
  PORT: z.coerce.number(),
  JWT_SECRET: z.string().min(32),
});

export const makeAppConfig = Effect.gen(function* () {
  const env = yield* loadEnv(envSchema);
  return {
    app: {
      port: env["PORT"],
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


