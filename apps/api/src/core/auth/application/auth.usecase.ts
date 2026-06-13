import { Effect, Layer, Option } from "effect";
import { AuthResponse, LoginInput, RegisterInput } from "@gold-platform/types";
import { makeUserRepository } from "../../user/adapter/user.repository.js";
import { UserRepository } from "../../user/port/user.port.js";
import { InvalidCredentialsError, DuplicateEmailError } from "../domain/auth.error.js";
import { HashService, makeBcryptHashService } from "../../../infrastructure/utils/hasher.js";
import { PublicUser, User } from "../../user/domain/user.entity.js";
import { JWTService, makeJwtServie } from "../../../infrastructure/utils/jwt.js";
import { TApp } from "../../../infrastructure/runtime.js";

const findUserByEmail = ({ email, password }: LoginInput) => Effect.gen(function* () {
    const repo = yield* UserRepository
    const user = yield* repo.findByEmail(email);
    if (Option.isNone(user)) return yield* Effect.fail(new InvalidCredentialsError({ message: "Invalid email or password" }))
    return {
        ...user.value, password
    }
})

const comparePassword = ({ passwordHash, password, email, name, id }: User & { password: string }) => Effect.gen(function* () {
    const hasher = yield* HashService
    const isMatch = yield* hasher.compare(password, passwordHash)
    if (!isMatch) return yield* Effect.fail(new InvalidCredentialsError({ message: "Invalid email or password" }))
    return { id, name, email }
})

const createJwtPayload = ({ id, name, email }: PublicUser) => Effect.gen(function* () {
    const jwtService = yield* JWTService
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = yield* jwtService.sign({ sub: id, email, exp })
    return {
        user: { id, name, email }, token
    } satisfies { token: string, user: PublicUser }
})

const validateExistingEmail = (req: RegisterInput) => Effect.gen(function* () {
    const repo = yield* UserRepository
    const record = yield* repo.findByEmail(req.email);
    if (Option.isSome(record)) return yield* Effect.fail(new DuplicateEmailError());
    return req
});

const hashPassword = ({ name, email, password }: RegisterInput) => Effect.gen(function* () {
    const hasher = yield* HashService
    const passwordHash = yield* hasher.hash(password)
    return { name, email, passwordHash }
});

const saveUser = (req: Omit<RegisterInput, 'password'> & { passwordHash: string }) => Effect.gen(function* () {
    const repo = yield* UserRepository
    return yield* repo.createUser(req)
});

const makeLoginCase = (req: LoginInput) => findUserByEmail(req).pipe(
    Effect.flatMap(comparePassword),
    Effect.flatMap(createJwtPayload),
)

const makeRegisterUserCase = (req: RegisterInput) => validateExistingEmail(req).pipe(
    Effect.flatMap(validReq => hashPassword(validReq)),
    Effect.flatMap(entry => saveUser(entry)),
    Effect.flatMap(user => createJwtPayload(user)),
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

    register(req: RegisterInput) {
        return this.runtime.runPromiseExit(
            Effect.provide(makeRegisterUserCase(req), this.authDepLive)
        )
    }
}
