import { Context, Effect } from "effect";
import { Option } from "effect/Option";
import { User } from "../domain/user.entity.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import type { UserRole } from "../../../infrastructure/db/schema/user.schema.js";
import { UserNotFoundError } from "../domain/user.error.js";
/**
 * Creating a login. `role` is optional and omitting it falls through to the column default,
 * OPERATOR — privilege has to be asked for, so a forgotten field can only ever produce the less
 * powerful account.
 *
 * It was previously absent from this type while the usecase passed it anyway: the call site hands
 * over a variable rather than a fresh literal, so excess-property checking never fired and the
 * field was persisted without the contract ever admitting it existed.
 */
export type CreateUserReq = {
  name: string;
  username: string;
  passwordHash: string;
  role?: UserRole;
};

//driven port
export interface ForUserRepository {
  findAll: () => Effect.Effect<User[], RepositoryError>;
  findById: (id: number) => Effect.Effect<Option<User>, RepositoryError>;
  /**
   * Looks a username up **including deactivated accounts**, deliberately.
   *
   * Both callers need it that way and for opposite reasons. Creating an account has to see a
   * deactivated row or it would offer a username the unique index will then refuse, turning a
   * clear "already taken" into a 500 from the database. Login has to see it in order to reject
   * it — a filter here would instead make a deactivated account fall through to "no such user",
   * which is the same outcome by luck rather than by rule, and would silently stop being true if
   * the filter ever moved.
   */
  findByUsername: (username: string) => Effect.Effect<Option<User>, RepositoryError>;
  createUser: (data: CreateUserReq) => Effect.Effect<User, RepositoryError>;
  /** Sets the tombstone. Already-deactivated is not an error — the caller asked for a state. */
  deactivateById: (id: number) => Effect.Effect<User, UserNotFoundError | RepositoryError>;
  /** Clears the tombstone, letting the account sign in again. */
  restoreById: (id: number) => Effect.Effect<User, UserNotFoundError | RepositoryError>;
  /** How many administrators can still sign in — the number `LastAdminError` guards. */
  countActiveAdmins: () => Effect.Effect<number, RepositoryError>;
}

export class UserRepository extends Context.Tag("UserRepository")<UserRepository, ForUserRepository>() { }