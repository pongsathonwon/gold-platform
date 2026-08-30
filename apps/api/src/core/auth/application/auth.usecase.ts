import { Effect, Layer, Option } from "effect";
import { LoginInput, RegisterInput } from "@gold-platform/types";
import { makeUserRepository } from "../../user/adapter/user.repository.js";
import { UserRepository } from "../../user/port/user.port.js";
import { InvalidCredentialsError, DuplicateEmailError } from "../domain/auth.error.js";
import { HashService, makeBcryptHashService } from "../../../infrastructure/utils/hasher.js";
import { PublicUser, User, isActive, toPublicUser } from "../../user/domain/user.entity.js";
import { JWTService, makeJwtServie } from "../../../infrastructure/utils/jwt.js";
import { TApp } from "../../../infrastructure/runtime.js";

const findUserByUsername = ({ username, password }: LoginInput) => Effect.gen(function* () {
    const repo = yield* UserRepository
    const user = yield* repo.findByUsername(username);
    if (Option.isNone(user)) return yield* Effect.fail(new InvalidCredentialsError({ message: "Invalid username or password" }))
    /**
     * A deactivated account cannot sign in. Checked here rather than by filtering the lookup,
     * because `findByUsername` must keep returning deactivated rows for the duplicate-username
     * check — and a rule that holds only as a side effect of someone else's query is a rule that
     * stops holding the day that query changes.
     *
     * The refusal is the same InvalidCredentialsError a wrong password gets, deliberately: telling
     * an unauthenticated caller that an account exists but is switched off confirms the username.
     */
    if (!isActive(user.value)) return yield* Effect.fail(new InvalidCredentialsError({ message: "Invalid username or password" }))
    return { ...user.value, password }
})

const comparePassword = (user: User & { password: string }) => Effect.gen(function* () {
    const hasher = yield* HashService
    const isMatch = yield* hasher.compare(user.password, user.passwordHash)
    if (!isMatch) return yield* Effect.fail(new InvalidCredentialsError({ message: "Invalid username or password" }))
    // Through toPublicUser rather than picking fields by hand, so the shape the client receives is
    // the one every other endpoint returns and cannot drift from it.
    return toPublicUser(user)
})

/**
 * The token carries the role, so authorisation costs no database round trip per request.
 *
 * The trade is that a role change does not take effect until the holder's current token expires —
 * acceptable at a one-hour lifetime, and the alternative (a user lookup on every request) buys
 * revocation speed nobody has asked for at a cost paid on every call.
 */
const createJwtPayload = (user: PublicUser) => Effect.gen(function* () {
    const jwtService = yield* JWTService
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = yield* jwtService.sign({ sub: user.id, username: user.username, role: user.role, exp })
    return { user, token } satisfies { token: string, user: PublicUser }
})

const validateExistingUsername = (req: RegisterInput) => Effect.gen(function* () {
    const repo = yield* UserRepository
    const record = yield* repo.findByUsername(req.username);
    if (Option.isSome(record)) return yield* Effect.fail(new DuplicateEmailError());
    return req
});

const hashPassword = ({ name, username, password, role }: RegisterInput) => Effect.gen(function* () {
    const hasher = yield* HashService
    const passwordHash = yield* hasher.hash(password)
    // role omitted falls through to the column default, OPERATOR — the least privileged value
    return { name, username, passwordHash, role }
});

const saveUser = (req: Omit<RegisterInput, 'password'> & { passwordHash: string }) => Effect.gen(function* () {
    const repo = yield* UserRepository
    return yield* repo.createUser(req)
});

/**
 * Creating a login for someone else. Unlike `login`, this returns no token: the admin doing the
 * creating must not walk away holding a session as the account they just made.
 */
const makeCreateUserCase = (req: RegisterInput) => validateExistingUsername(req).pipe(
    Effect.flatMap(hashPassword),
    Effect.flatMap(saveUser),
    Effect.map(toPublicUser),
)

const makeLoginCase = (req: LoginInput) => findUserByUsername(req).pipe(
    Effect.flatMap(comparePassword),
    Effect.flatMap(createJwtPayload),
)



export class AuthUseCase {
    private readonly authDepLive = Layer.effect(UserRepository, makeUserRepository).pipe(
        Layer.merge(Layer.effect(JWTService, makeJwtServie)),
        Layer.merge(Layer.effect(HashService, makeBcryptHashService))
    )

    constructor(private readonly runtime: TApp) { }

    login(req: LoginInput) {
        return this.runtime.runPromiseExit(
            Effect.provide(makeLoginCase(req), this.authDepLive)
        )
    }

    /** Admin-only: issues an account, not a session. See `makeCreateUserCase`. */
    createUser(req: RegisterInput) {
        return this.runtime.runPromiseExit(
            Effect.provide(makeCreateUserCase(req), this.authDepLive)
        )
    }
}
