import { Cause, Exit } from "effect";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DatabaseConnectionError, DrizzleInitializeError, RepositoryError, SchemaError } from "../db/client.js";
import type { ConfigError } from "../utils/env.js";
import type { UnknownException } from "effect/Cause";

export type TErrorKey<Err extends Record<string, any>> = Err extends { _tag: string } ? Err['_tag'] : never

type InfraError =
  | DatabaseConnectionError
  | DrizzleInitializeError
  | SchemaError
  | ConfigError
  | RepositoryError
  | UnknownException;

type InfraErrorTag = TErrorKey<InfraError>;

type ErrorResponse = { error: string; code: string };

const infraErrorMap: Record<InfraErrorTag, ErrorResponse> = {
  DatabaseConnectionError: { error: "Database connection failed", code: "DB_CONNECTION" },
  DrizzleInitializeError: { error: "Database initialization failed", code: "DB_INIT" },
  SchemaError: { error: "Schema load failed", code: "DB_SCHEMA" },
  ConfigError: { error: "Server configuration error", code: "CONFIG" },
  RepositoryError: { error: "Database query failed", code: "DB_QUERY" },
  UnknownException: { error: "Unexpected error", code: "UNKNOWN" },
};

/**
 * The fallback every domain router's `toHttpError` chain ends with.
 *
 * It replaced `return [JSON.stringify(error), 500]`, which was in all twelve of them. That line
 * served the *internal* error object to the caller as the user-facing message: an Effect
 * `Data.TaggedError` serialises its fields, so a `RepositoryError` handed the client whatever
 * Postgres said — table and column names, constraint names, fragments of the failing statement.
 * None of that is a message an operator can act on, and all of it describes the inside of the
 * system to whoever asked. It also produced JSON text where every other branch produces a
 * sentence, so the UI rendered a stringified object into a Thai-language error toast.
 *
 * Infrastructure failures still get their own wording, from the same map `handleExit` uses, so the
 * two entry points cannot describe a dead database differently. Everything else is one sentence.
 *
 * The detail is not discarded — it moves to the server log, which is where it was always useful
 * and where it costs nothing to be verbose. `route` names the caller so a log line says which
 * router produced it.
 */
export const unhandledError = (
  error: unknown,
  route: string,
): [string, ContentfulStatusCode] => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? String((error as { _tag: unknown })._tag)
      : undefined;

  if (tag && tag in infraErrorMap) {
    console.error(`[${route}] ${tag}`, error);
    return [infraErrorMap[tag as InfraErrorTag].error, 500];
  }

  // Includes the plain strings `runEffect` returns for a died or interrupted fiber, which carry no
  // `_tag` at all and are the least presentable thing that could reach a caller.
  console.error(`[${route}] unmapped error`, error);
  return ["Internal server error", 500];
};

export const handleExit = <T, E extends { _tag: string }>(
  c: Context,
  exit: Exit.Exit<T, E>,
  onSuccess: (value: T) => Response,
  domainErrors: Partial<Record<string, readonly [string, ContentfulStatusCode]>> = {}
): Response => {
  if (Exit.isSuccess(exit)) return onSuccess(exit.value);

  const cause = exit.cause;

  if (!Cause.isFailType(cause)) {
    console.error("[Defect]", Cause.pretty(cause));
    return c.json({ error: "Internal server error", code: "DEFECT" }, 500);
  }

  const tag = cause.error._tag;

  const domain = domainErrors[tag];
  if (domain) {
    const [error, status] = domain;
    return c.json({ error, code: tag }, status);
  }

  const isInfraTag = (t: string): t is InfraErrorTag => t in infraErrorMap;
  if (isInfraTag(tag)) return c.json(infraErrorMap[tag], 500);

  console.error("[Unhandled error tag]", tag);
  return c.json({ error: "Internal server error", code: "UNKNOWN" }, 500);
};
