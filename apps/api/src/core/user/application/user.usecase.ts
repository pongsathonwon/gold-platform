import { Effect, Layer, Option } from "effect";
import { ForUserUseCase, UserRepository } from "../port/user.port.js";
import { TApp } from "../../../infrastructure/runtime.js";
import { makeUserRepository } from "../adapter/user.repository.js";
import { UserNotFoundError } from "../domain/user.error.js";

export const makeDeleteUserUseCase = (id: number) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    const result = yield* repo.deleteById(id);
    return result;
  });

export const makeFindUserByIdCase = (id: number) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    const result = yield* repo.findById(id);
    return yield* Option.match(result, {
      onSome: Effect.succeed,
      onNone: () => Effect.fail(new UserNotFoundError({ id }))
    })
  });

export const makeFindAllUsersCase = () =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    const result = yield* repo.findAll();
    return result;
  });


export class UserManagementUseCase implements ForUserUseCase {

  private readonly userServiceLive = Layer.scoped(UserRepository, makeUserRepository);

  constructor(private readonly runtime: TApp) { }

  findAllUser() {
    return this.runtime.runPromiseExit(
      makeFindAllUsersCase()
        .pipe(Effect.provide(this.userServiceLive))
    )
  }

  findUserById(id: number) {
    return this.runtime.runPromiseExit(
      makeFindUserByIdCase(id)
        .pipe(
          Effect.provide(this.userServiceLive)
        )
    )
  }

  deleteUserById(id: number) {
    return this.runtime.runPromiseExit(
      makeDeleteUserUseCase(id)
        .pipe(
          Effect.provide(this.userServiceLive)
        )
    )
  }

} 