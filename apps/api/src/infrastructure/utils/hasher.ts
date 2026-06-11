import bcrypt from "bcryptjs";
import { Context, Effect, Layer } from "effect";
import { UnknownException } from "effect/Cause";

interface ForHash {
  compare: (
    password: string,
    hashed: string,
  ) => Effect.Effect<boolean, UnknownException>;
  hash: (password: string) => Effect.Effect<string, UnknownException>;
}

export class HashService extends Context.Tag("HashService")<
  HashService,
  ForHash
>() { }

export class BcryptHashService implements ForHash {
  compare = (password: string, hashed: string) =>
    Effect.tryPromise(async () => await bcrypt.compare(password, hashed));

  hash = (password: string) =>
    Effect.tryPromise(async () => await bcrypt.hash(password, 10));
}

export const makeBcryptHashService = Effect.sync(() => new BcryptHashService())


// Effect.gen(function* () {
//   const compare = (password: string, hashed: string) =>
//     Effect.tryPromise(async () => await bcrypt.compare(password, hashed));

//   const hash = (password: string) =>
//     Effect.tryPromise(async () => await bcrypt.hash(password, 10));
//   return {
//     compare,
//     hash,
//   } satisfies ForHash;
// });

