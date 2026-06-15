import { Context, Effect } from "effect";
import { Option } from "effect/Option";
import { User } from "../domain/user.entity.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { UserNotFoundError } from "../domain/user.error.js";
//driven port
export interface ForUserRepository {
  findAll: () => Effect.Effect<User[], RepositoryError>;
  findById: (id: number) => Effect.Effect<Option<User>, RepositoryError>;
  findByUsername: (username: string) => Effect.Effect<Option<User>, RepositoryError>;
  createUser: (data: { name: string; username: string; passwordHash: string }) => Effect.Effect<User, RepositoryError>;
  deleteById: (id: number) => Effect.Effect<User, UserNotFoundError | RepositoryError>;
}

export class UserRepository extends Context.Tag("UserRepository")<UserRepository, ForUserRepository>() { }