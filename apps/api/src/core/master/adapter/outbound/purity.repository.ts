import { Database, DrizzleClient, RepositoryError } from "../../../../infrastructure/db/client.js";
import { purities } from "../../../../infrastructure/db/schema/master.schema.js";
import { ForViewPurity, PurityNotFound } from "../../port/purity.port.js";
import { Effect } from "effect";
import { eq } from "drizzle-orm";

class PurityRepository implements ForViewPurity {
    constructor(private readonly db: Database) { }
    listPurities() {
        return Effect.tryPromise({
            try: () => this.db.select().from(purities).execute(),
            catch: (_) => new RepositoryError({ message: 'cannot list purities' }),
        });
    }
    findPurityById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(purities).where(eq(purities.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find purity id : ${id}` })
        }).pipe(
            Effect.flatMap(res => {
                if (res.length !== 1) return Effect.fail(new PurityNotFound())
                return Effect.succeed(res[0])
            })
        )
    }
}

export const makePurityRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient
    return new PurityRepository(db);
});