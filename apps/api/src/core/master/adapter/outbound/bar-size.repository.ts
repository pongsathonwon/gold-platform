import { Database, DrizzleClient, RepositoryError } from "../../../../infrastructure/db/client.js";
import { barSizes } from "../../../../infrastructure/db/schema/master.schema.js";
import { BarSizeNotFound, ForViewBarSize } from "../../port/bar-size.port.js";
import { Effect } from "effect";
import { eq } from "drizzle-orm";

class BarSizeRepository implements ForViewBarSize {
    constructor(private readonly db: Database) { }

    listBarSizes() {
        return Effect.tryPromise({
            try: () => this.db.select().from(barSizes).execute(),
            catch: () => new RepositoryError({ message: "cannot list bar sizes" }),
        });
    }

    findBarSizeById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(barSizes).where(eq(barSizes.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find bar size id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) => {
                if (res.length !== 1) return Effect.fail(new BarSizeNotFound());
                return Effect.succeed(res[0]);
            })
        );
    }
}

export const makeBarSizeRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new BarSizeRepository(db);
});
