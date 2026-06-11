import { Layer, ManagedRuntime } from "effect";
import { DatabaseConnectionError, DrizzleClient, DrizzleInitializeError, makeClient } from "./db/client.js";
import { AppConfig, ConfigError, makeAppConfig } from "./utils/env.js";
import { UnknownException } from "effect/Cause";

export const AppConfigLive = Layer.effect(AppConfig, makeAppConfig);

const AppLayer = Layer
  .scoped(DrizzleClient, makeClient)
  .pipe(
    Layer.provideMerge(Layer.effect(AppConfig, makeAppConfig))
  )


export const appRuntime = ManagedRuntime.make(AppLayer);

export type TApp = typeof appRuntime


export type TBaseError = UnknownException | DrizzleInitializeError | DatabaseConnectionError | ConfigError