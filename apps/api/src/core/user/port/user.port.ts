import { Context, Effect } from "effect";
import { Option } from "effect/Option";
import { User } from "../domain/user.entity.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { UserNotFoundError } from "../domain/user.error.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { TBaseError } from "../../../infrastructure/runtime.js";

//driven port
export interface ForUserRepository {
  findAll: () => Effect.Effect<User[], RepositoryError>;
  findById: (id: number) => Effect.Effect<Option<User>, RepositoryError>;
  findByEmail: (email: string) => Effect.Effect<Option<User>, RepositoryError>;
  createUser: (data: { name: string; email: string; passwordHash: string }) => Effect.Effect<User, RepositoryError>;
  deleteById: (id: number) => Effect.Effect<User, UserNotFoundError | RepositoryError>;
}

export class UserRepository extends Context.Tag("UserRepository")<UserRepository, ForUserRepository>() { }


type PossibleUserCaseError = RepositoryError

export interface ForUserUseCase {
  findAllUser(): AppReturnShape<User[], PossibleUserCaseError | TBaseError>
  findUserById(id: number): AppReturnShape<User, UserNotFoundError | PossibleUserCaseError | TBaseError>
  deleteUserById(id: number): AppReturnShape<User, UserNotFoundError | PossibleUserCaseError | TBaseError>
}