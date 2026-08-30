import { and, count, DrizzleError, DrizzleQueryError, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import { UserNotFoundError } from "../domain/user.error.js";
import { Context, Effect, Option } from "effect";
import { DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import { users } from "../../../infrastructure/db/schema/user.schema.js";
import { CreateUserReq, ForUserRepository } from "../port/user.port.js";


const mapRepositoryError = (error: unknown): RepositoryError => {
  if (error instanceof TransactionRollbackError) {
    return new RepositoryError({ message: "transaction failed" });
  }
  if (error instanceof DrizzleQueryError) {
    return new RepositoryError({ message: `query error: ${error.message}` });
  }
  if (error instanceof DrizzleError) {
    return new RepositoryError({ message: `drizzle error: ${error.message}` });
  }
  if (error instanceof Error) {
    return new RepositoryError({ message: error.message });
  }
  return new RepositoryError({ message: `unknown error: ${JSON.stringify(error)}` });
};

export const makeUserRepository = Effect.gen(function* () {
  const db = yield* DrizzleClient;
  const findAll = () =>
    Effect.tryPromise({
      try: () => db.select().from(users),
      catch: mapRepositoryError,
    });

  const findById = (id: number) =>
    Effect.tryPromise({
      try: async () => {
        const result = await db.select().from(users).where(eq(users.id, id));
        return result.length === 1 ? Option.some(result[0]) : Option.none();
      },
      catch: mapRepositoryError,
    });

  const findByUsername = (username: string) =>
    Effect.tryPromise({
      try: async () => {
        const result = await db.select().from(users).where(eq(users.username, username));
        return result.length === 1 ? Option.some(result[0]) : Option.none();
      },
      catch: mapRepositoryError,
    });

  const createUser = (data: CreateUserReq) =>
    Effect.tryPromise({
      try: async () => {
        const result = await db.insert(users).values(data).returning();
        if (result.length !== 1) throw new Error("insert returned no rows");
        return result[0];
      },
      catch: mapRepositoryError,
    });

  // Deactivation and restoration are the same UPDATE with a different value, so they share one
  // implementation — the tombstone is the whole of the state.
  const setDeletedAt = (id: number, deletedAt: Date | null) =>
    Effect.tryPromise({
      try: () => db.update(users).set({ deletedAt }).where(eq(users.id, id)).returning(),
      catch: mapRepositoryError,
    }).pipe(
      Effect.flatMap((result) =>
        result.length === 1
          ? Effect.succeed(result[0])
          : Effect.fail(new UserNotFoundError({ id })),
      ),
    );

  const deactivateById = (id: number) => setDeletedAt(id, new Date());

  const restoreById = (id: number) => setDeletedAt(id, null);

  const countActiveAdmins = () =>
    Effect.tryPromise({
      try: async () => {
        const result = await db
          .select({ count: count() })
          .from(users)
          .where(and(eq(users.role, "ADMIN"), isNull(users.deletedAt)));
        return result[0]?.count ?? 0;
      },
      catch: mapRepositoryError,
    });

  return {
    findAll,
    findById,
    findByUsername,
    createUser,
    deactivateById,
    restoreById,
    countActiveAdmins,
  } satisfies ForUserRepository;
})

export class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  ForUserRepository
>() { }
