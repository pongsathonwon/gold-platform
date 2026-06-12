import { Context, Data, Effect } from "effect";
import { BarSize } from "../../../infrastructure/db/schema/master.schema.js";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TErrorKey } from "../../../infrastructure/http/errors.js";

export class BarSizeNotFound extends Data.TaggedError("BarSizeNotFound") {}

type PossibleError = RepositoryError

export interface ForViewBarSize {
    listBarSizes(): Effect.Effect<BarSize[], PossibleError | TBaseError>
    findBarSizeById(id: string): Effect.Effect<BarSize, PossibleError | BarSizeNotFound | TBaseError>
}

export class BarSizeRepository extends Context.Tag("BarSizeRepository")<BarSizeRepository, ForViewBarSize>() {}

export interface ForBarSizeUseCase {
    listBarSizes(): AppReturnShape<BarSize[], PossibleError | TBaseError>
    findBarSizeById(id: string): AppReturnShape<BarSize, PossibleError | BarSizeNotFound | TBaseError>
}

export type BarSizeErrorTag = TErrorKey<BarSizeNotFound>
