import { Context, Data, Effect } from "effect";
import { Branch } from "../../../infrastructure/db/schema/master.schema.js";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TErrorKey } from "../../../infrastructure/http/errors.js";

export class BranchNotFound extends Data.TaggedError("BranchNotFound") {}

type PossibleError = RepositoryError

export interface ForViewBranch {
    listBranches(): Effect.Effect<Branch[], PossibleError | TBaseError>
    findBranchById(id: string): Effect.Effect<Branch, PossibleError | BranchNotFound | TBaseError>
}

export class BranchRepository extends Context.Tag("BranchRepository")<BranchRepository, ForViewBranch>() {}

export interface ForBranchUseCase {
    listBranches(): AppReturnShape<Branch[], PossibleError | TBaseError>
    findBranchById(id: string): AppReturnShape<Branch, PossibleError | BranchNotFound | TBaseError>
}

export type BranchErrorTag = TErrorKey<BranchNotFound>
