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
  findByUsername: (username: string) => Effect.Effect<Option<User>, RepositoryError>;
  createUser: (data: CreateUserReq) => Effect.Effect<User, RepositoryError>;
  deleteById: (id: number) => Effect.Effect<User, UserNotFoundError | RepositoryError>;
}

export class UserRepository extends Context.Tag("UserRepository")<UserRepository, ForUserRepository>() { }