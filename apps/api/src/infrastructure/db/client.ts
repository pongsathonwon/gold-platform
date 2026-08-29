import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Context, Data, Effect, Schedule } from "effect";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { AppConfig } from "../utils/env.js";
import { socketOptions } from "./connection.js";

export class RepositoryError extends Data.TaggedError("RepositoryError")<{ message: string }> { }

export type Schema = typeof import('../db/schema/index.js');

export type Database = PostgresJsDatabase<Schema>;

export class SchemaError extends Data.TaggedError('SchemaError') { }

const loadSchema = Effect.tryPromise({
  try: () => import('../db/schema/index.js'),
  catch: (_) => new DatabaseConnectionError({ message: 'cannot load db schema', level: 'loading schema error' })
});

export class DatabaseConnectionError extends Data.TaggedError(
  "DatabaseConnectionError",
)<{ message: string, level: string }> { }

export class DrizzleInitializeError extends Data.TaggedError(
  "DrizzleInitializeError",
)<{ message: string; payload: unknown }> { }

const mapDatabaseConnectionError = (error: unknown) => {
  if (error instanceof postgres.PostgresError) {
    return new DatabaseConnectionError({
      message: `[${error.code}] : ${error.message}`, level: 'creating connection fail'
    });
  }
  if (error instanceof Error) {
    return new DatabaseConnectionError({
      message: `[unknown error] : ${error.message}`, level: 'creating connection fail'
    });
  }
  const stringErr = JSON.stringify(error);
  return new DatabaseConnectionError({
    message: `[unknown error] : ${stringErr}`, level: 'creating connection fail'
  });
};

/**
 * Connections per instance.
 *
 * postgres.js defaults to 10, and that default is the wrong shape for this deployment: the number
 * that reaches the database is `max` × the Cloud Run instance ceiling, so an unstated 10 quietly
 * became 40 against a shared-core Cloud SQL instance whose own limit is not much higher — and the
 * migration job wants a connection too. Five against a ceiling of two revisions bounds it at ten.
 *
 * It is not a throughput constraint at this volume. The four transaction domains together see on
 * the order of 60 writes a day, so a single connection would serve them; the pool is sized for
 * concurrent *requests* — a page opening several queries at once — not for load.
 */
const MAX_CONNECTIONS_PER_INSTANCE = 5

export const makeConnection = (url: string) =>
  Effect.try({
    try: () => postgres(url, {
      max: MAX_CONNECTIONS_PER_INSTANCE,
      // Cloud SQL's unix socket, which cannot travel in the URL string — see connection.ts.
      ...socketOptions(url),
      types: { date: { to: 1082, from: [1082], serialize: (d: string) => d, parse: (d: string) => d } },
    }),
    catch: (error) => mapDatabaseConnectionError(error),
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

const healthCheck = (db: PostgresJsDatabase<Schema>) =>
  Effect.tryPromise({
    try: () => db.execute(sql`select 1`),
    catch: (error) => {
      if (error instanceof Error) {
        return new DatabaseConnectionError({ message: `[known error] : ${error.message}`, level: 'drizzle fail' })
      }
      return new DatabaseConnectionError({ message: `[unknown error] : ${JSON.stringify(error)}`, level: 'drizzle fail' })
    }
  }).pipe(
    Effect.retry(retrySchedule),
    Effect.tap(() => Effect.logInfo("[Database] : connected successfully")),
  );

export class DrizzleClient extends Context.Tag("DrizzleClient")<
  DrizzleClient, Database
>() { }

export const makeClient = Effect.gen(function* () {
  const config = yield* AppConfig;
  const schema = yield* loadSchema
  const pool = yield* makeConnection(config.database.url);
  yield* Effect.addFinalizer(() => Effect.promise(() => pool.end()));
  const db = drizzle(pool, {
    schema,
    casing: 'snake_case'
  });
  yield* healthCheck(db);
  return db
});

