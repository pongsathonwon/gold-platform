import { Database, DrizzleClient, RepositoryError } from "../../../../infrastructure/db/client.js";
import { branches } from "../../../../infrastructure/db/schema/master.schema.js";
import { BranchNotFound, ForViewBranch } from "../../port/branch.port.js";
import { Effect } from "effect";
import { eq } from "drizzle-orm";

class BranchRepository implements ForViewBranch {
    constructor(private readonly db: Database) { }

    listBranches() {
        return Effect.tryPromise({
            try: () => this.db.select().from(branches).execute(),
            catch: () => new RepositoryError({ message: "cannot list branches" }),
        });
    }

    findBranchById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(branches).where(eq(branches.branchCode, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find branch id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) => {
                if (res.length !== 1) return Effect.fail(new BranchNotFound());
                return Effect.succeed(res[0]);
            })
        );
    }
}

export const makeBranchRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new BranchRepository(db);
});
