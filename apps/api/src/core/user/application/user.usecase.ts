import { Effect, Layer, Option } from "effect";
import { UserRepository } from "../port/user.port.js";
import { TApp } from "../../../infrastructure/runtime.js";
import { makeUserRepository } from "../adapter/user.repository.js";
import {
  CannotDeactivateSelfError,
  LastAdminError,
  UserNotFoundError,
} from "../domain/user.error.js";
import { isActive } from "../domain/user.entity.js";

/**
 * Deactivates an account, refusing the two moves that cannot be undone from inside the app.
 *
 * `actorId` is the caller's own id, read from the verified token rather than the request body —
 * self-deactivation is refused, and a check the caller could supply the answer to is not a check.
 *
 * The last-admin rule is the one that matters. Creating accounts, restoring them and adjusting
 * inventory are all ADMIN-only, so an installation whose final administrator switches themselves
 * off cannot appoint a replacement: recovery is a manual UPDATE against the production database.
 * It is only evaluated when the target is an active admin, so deactivating an operator never pays
 * for the count.
 */
export const makeDeactivateUserUseCase = (id: string, actorId: string) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;

    if (id === actorId) return yield* Effect.fail(new CannotDeactivateSelfError({ id }));

    const found = yield* repo.findById(id);
    const target = yield* Option.match(found, {
      onSome: Effect.succeed,
      onNone: () => Effect.fail(new UserNotFoundError({ id })),
    });

    if (target.role === "ADMIN" && isActive(target)) {
      const admins = yield* repo.countActiveAdmins();
      if (admins <= 1) return yield* Effect.fail(new LastAdminError({ id }));
    }

    return yield* repo.deactivateById(id);
  });

/** Lets a deactivated account sign in again. Restoring is always safe — it only adds access. */
export const makeRestoreUserUseCase = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    return yield* repo.restoreById(id);
  });

export const makeFindUserByIdCase = (id: string) =>
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


export class UserManagementUseCase {

  private readonly userServiceLive = Layer.scoped(UserRepository, makeUserRepository);

  constructor(private readonly runtime: TApp) { }

  findAllUser() {
    return this.runtime.runPromiseExit(
      makeFindAllUsersCase()
        .pipe(Effect.provide(this.userServiceLive))
    )
  }

  findUserById(id: string) {
    return this.runtime.runPromiseExit(
      makeFindUserByIdCase(id)
        .pipe(
          Effect.provide(this.userServiceLive)
        )
    )
  }

  deactivateUserById(id: string, actorId: string) {
    return this.runtime.runPromiseExit(
      makeDeactivateUserUseCase(id, actorId)
        .pipe(
          Effect.provide(this.userServiceLive)
        )
    )
  }

  restoreUserById(id: string) {
    return this.runtime.runPromiseExit(
      makeRestoreUserUseCase(id)
        .pipe(
          Effect.provide(this.userServiceLive)
        )
    )
  }

} 