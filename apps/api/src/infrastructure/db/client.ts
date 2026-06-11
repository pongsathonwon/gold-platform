import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Context, Data, Effect, Schedule } from "effect";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index.js";
import { AppConfig } from "../utils/env.js";

export class RepositoryError extends Data.TaggedError("RepositoryError")<{ message: string }> { }

export type Database = PostgresJsDatabase<typeof schema>;

export class DatabaseConnectionError extends Data.TaggedError(
  "DatabaseConnectionError",
)<{ message: string; payload: unknown }> { }

export class DrizzleInitializeError extends Data.TaggedError(
  "DrizzleInitializeError",
)<{ message: string; payload: unknown }> { }

const mapDatabaseConnectionError = (error: unknown) => {
  if (error instanceof postgres.PostgresError) {
    return new DatabaseConnectionError({
      message: `[${error.code}] : ${error.message}`,
      payload: error,
    });
  }
  if (error instanceof Error) {
    return new DatabaseConnectionError({
      message: `[unknown error] : ${error.message}`,
      payload: error,
    });
  }
  const stringErr = JSON.stringify(error);
  return new DatabaseConnectionError({
    message: `[unknown error] : ${stringErr}`,
    payload: new Error(stringErr),
  });
};

export const makeConnection = (url: string) =>
  Effect.try({
    try: () => postgres(url),
    catch: (error) => mapDatabaseConnectionError(error),
  });

export const makeDrizzle = (pool: postgres.Sql) =>
  Effect.try({
    try: () => drizzle(pool, { schema }),
    catch: (error) =>
      new DrizzleInitializeError({
        message: "cannot initialize drizzle",
        payload: error,
      }),
  });

const retrySchedule = Schedule.jitteredWith(Schedule.spaced("1.2 seconds"), {
  min: 0.5,
  max: 1.5,
}).pipe(
  Schedule.intersect(Schedule.recurs(5)),
  Schedule.tapOutput(([, attempt]) =>
    Effect.logWarning(
      `[Database] : Connect to Database fail. Retry ${attempt} attempt(s)`,
    ),
  ),
);

const healthCheck = (db: PostgresJsDatabase<typeof schema>) =>
  Effect.tryPromise(() => db.execute(sql`select 1`)).pipe(
    Effect.retry(retrySchedule),
    Effect.tap(() => Effect.logInfo("[Database] : connected successfully")),
  );

export class DrizzleClient extends Context.Tag("DrizzleClient")<
  DrizzleClient,
  Database
>() { }

export const makeClient = Effect.gen(function* () {
  const config = yield* AppConfig;
  const pool = yield* makeConnection(config.database.url);
  yield* Effect.addFinalizer(() => Effect.promise(() => pool.end()));
  const db = yield* makeDrizzle(pool);
  yield* healthCheck(db);
  return db;
});

