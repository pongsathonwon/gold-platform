import { Context, Data, Effect } from "effect";
import { Purity } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class PurityNotFound extends Data.TaggedError('PurityNotFound') { }

export interface ForViewPurity {
    listPurities(): Effect.Effect<Purity[], RepositoryError>
    findPurityById(id: string): Effect.Effect<Purity, RepositoryError | PurityNotFound>
}

export class PurityRepository extends Context.Tag("PurityRepository")<PurityRepository, ForViewPurity>() { }