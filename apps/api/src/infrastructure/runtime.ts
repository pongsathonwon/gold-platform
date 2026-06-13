import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { DrizzleClient, makeClient } from "./db/client.js";
import { AppConfig, makeAppConfig } from "./utils/env.js";

export const AppConfigLive = Layer.effect(AppConfig, makeAppConfig);

const AppLayer = Layer
  .scoped(DrizzleClient, makeClient)
  .pipe(
    Layer.provideMerge(Layer.effect(AppConfig, makeAppConfig))
  )

export type BaseError = Layer.Layer.Error<typeof AppLayer>

export const appRuntime = ManagedRuntime.make(AppLayer);

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

export async function runEffect<R, E>(effect: Effect.Effect<R, E, AppConfig | DrizzleClient>): Promise<Result<R, string>> {
  const result = await appRuntime.runPromiseExit(effect)
  if (Exit.isSuccess(result)) return {
    result: 'success',
    data: result.value,
  }
  const cause = result.cause
  if (Cause.isEmptyType(cause)) {
    return { result: 'fail', error: 'fail without definition' }
  }
  if (Cause.isDieType(cause)) {
    return { result: 'fail', error: `runtime dies ${cause.defect}` }
  }
  if (Cause.isInterruptType(cause)) {
    return { result: 'fail', error: `fiber ${cause.fiberId} die` }
  }
  if (Cause.isSequentialType(cause)) {
    return { result: 'fail', error: JSON.stringify(cause) }
  }
  if (Cause.isParallelType(cause)) {
    return { result: 'fail', error: JSON.stringify(cause) }
  }
  return {
    result: 'fail',
    error: JSON.stringify(cause.error)
  }
}

export type AppReturnShape<T, E> = Promise<Exit.Exit<T, E | BaseError>>