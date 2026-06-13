import { Context, Data, Effect } from "effect";
import { Branch } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class BranchNotFound extends Data.TaggedError("BranchNotFound") {}

export interface ForViewBranch {
    listBranches(): Effect.Effect<Branch[], RepositoryError>
    findBranchById(id: string): Effect.Effect<Branch, RepositoryError | BranchNotFound>
}

export class BranchRepository extends Context.Tag("BranchRepository")<BranchRepository, ForViewBranch>() {}
