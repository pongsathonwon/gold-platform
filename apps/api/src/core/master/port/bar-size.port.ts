import { Context, Data, Effect } from "effect";
import { BarSize } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class BarSizeNotFound extends Data.TaggedError("BarSizeNotFound") {}

export interface ForViewBarSize {
    listBarSizes(): Effect.Effect<BarSize[], RepositoryError>
    findBarSizeById(id: string): Effect.Effect<BarSize, RepositoryError | BarSizeNotFound>
}

export class BarSizeRepository extends Context.Tag("BarSizeRepository")<BarSizeRepository, ForViewBarSize>() {}
