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
