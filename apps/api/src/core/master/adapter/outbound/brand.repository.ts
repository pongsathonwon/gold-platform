import { Database, DrizzleClient, RepositoryError } from "../../../../infrastructure/db/client.js";
import { brands } from "../../../../infrastructure/db/schema/master.schema.js";
import { BrandNotFound, ForViewBrand } from "../../port/brand.port.js";
import { Effect } from "effect";
import { eq } from "drizzle-orm";

class BrandRepository implements ForViewBrand {
    constructor(private readonly db: Database) { }

    listBrands() {
        return Effect.tryPromise({
            try: () => this.db.select().from(brands).execute(),
            catch: () => new RepositoryError({ message: "cannot list brands" }),
        });
    }

    findBrandById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(brands).where(eq(brands.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find brand id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) => {
                if (res.length !== 1) return Effect.fail(new BrandNotFound());
                return Effect.succeed(res[0]);
            })
        );
    }
}

export const makeBrandRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new BrandRepository(db);
});
