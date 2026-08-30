import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { DrizzleClient, makeClient } from "./db/client.js";
import {
  DatabaseConfig, HttpConfig, JwtConfig,
  makeDatabaseConfig, makeHttpConfig, makeJwtConfig,
} from "./utils/env.js";

/**
 * The database and nothing else — what a scheduled job needs.
 *
 * A `ManagedRuntime` builds every layer it was given, so the split in `env.ts` only pays off if
 * there is a runtime that was never given the others. The confirm sweep runs on this one and
 * therefore never reads `JWT_SECRET` or `CORS_ORIGIN`, which is the point.
 */
const DatabaseLayer = Layer
  .scoped(DrizzleClient, makeClient)
  .pipe(
    Layer.provideMerge(Layer.effect(DatabaseConfig, makeDatabaseConfig))
  )

/** The database plus what serving HTTP additionally needs: a port, origins, a signing secret. */
const ServerLayer = DatabaseLayer.pipe(
  Layer.provideMerge(Layer.effect(JwtConfig, makeJwtConfig)),
  Layer.provideMerge(Layer.effect(HttpConfig, makeHttpConfig)),
)

export type BaseError = Layer.Layer.Error<typeof ServerLayer>

export const appRuntime = ManagedRuntime.make(ServerLayer);
export const jobRuntime = ManagedRuntime.make(DatabaseLayer);

export type TApp = typeof appRuntime

type SuccessEffect<T> = {
  result: 'success'
  data: T
}

type ErrorEffect<E> = {
  result: 'fail'
  error: E
}

type Result<T, E> = SuccessEffect<T> | ErrorEffect<E>

/** Runs an effect on the HTTP runtime — what every route handler calls. */
export async function runEffect<R, E>(
  effect: Effect.Effect<R, E, DatabaseConfig | JwtConfig | HttpConfig | DrizzleClient>,
): Promise<Result<R, E | BaseError | string>> {
  return toResult(await appRuntime.runPromiseExit(effect))
}

/**
 * Runs an effect on the database-only runtime — for scripts and scheduled jobs.
 *
 * Requiring `JwtConfig` here is a type error rather than a boot-time crash, which is the guard
 * that keeps a job from quietly acquiring an HTTP dependency again.
 */
export async function runJob<R, E>(
  effect: Effect.Effect<R, E, DatabaseConfig | DrizzleClient>,
): Promise<Result<R, E | BaseError | string>> {
  return toResult(await jobRuntime.runPromiseExit(effect))
}

function toResult<R, E>(result: Exit.Exit<R, E>): Result<R, E | BaseError | string> {
  if (Exit.isSuccess(result)) return {
    result: 'success',
    data: result.value,
  }
  const cause = result.cause
  if (Cause.isFailType(cause)) {
    return { result: 'fail', error: cause.error }
  }
  if (Cause.isDieType(cause)) {
    return { result: 'fail', error: `runtime died: ${cause.defect}` }
  }
  if (Cause.isInterruptType(cause)) {
    return { result: 'fail', error: `fiber interrupted: ${cause.fiberId}` }
  }
  return { result: 'fail', error: `unexpected cause: ${JSON.stringify(cause)}` }
}

export type AppReturnShape<T, E> = Promise<Exit.Exit<T, E | BaseError>>