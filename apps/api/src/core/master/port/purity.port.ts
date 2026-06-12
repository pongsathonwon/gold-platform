import { Context, Data, Effect } from "effect";
import { Purity } from "../../../infrastructure/db/schema/master.schema.js";
import { UnknownException } from "effect/Cause";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TErrorKey } from "../../../infrastructure/http/errors.js";

export class PurityNotFound extends Data.TaggedError('PurityNotFound') { }

type PossibleError = UnknownException | RepositoryError

export interface ForViewPurity {
    listPurities(): Effect.Effect<Purity[], PossibleError | TBaseError>
    findPurityById(id: string): Effect.Effect<Purity, PossibleError | PurityNotFound | TBaseError>
}

export class PurityRepository extends Context.Tag("PurityRepository")<PurityRepository, ForViewPurity>() { }

export interface ForPurityUseCase {
    listPurities(): AppReturnShape<Purity[], PossibleError | TBaseError>
    findPurityById(id: string): AppReturnShape<Purity, PossibleError | PurityNotFound | TBaseError>
}

export type PurityErrorTag = TErrorKey<PurityNotFound>