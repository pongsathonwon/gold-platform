import { Context, Effect } from "effect";
import { UnknownException } from "effect/Cause";
import { sign, verify } from "hono/jwt";
import { JWTPayload } from "hono/utils/jwt/types";
import { JwtConfig } from "./env.js";

interface ForJwt {
    sign: (payload: JWTPayload) => Effect.Effect<string, UnknownException>
    verify: (token: string) => Effect.Effect<JWTPayload, UnknownException>
}

export class JWTService extends Context.Tag("JWTService")<JWTService, ForJwt>() { }

class HonoJwtService implements ForJwt {
    constructor(private readonly secret: string) { }
    sign = (payload: JWTPayload) => Effect.tryPromise(async () => await sign(payload, this.secret, 'HS256'))
    verify = (token: string) => Effect.tryPromise(async () => await verify(token, this.secret, 'HS256'))
}

export const makeJwtServie = Effect.gen(function* () {
    const conf = yield* JwtConfig
    return new HonoJwtService(conf.secret)
});

