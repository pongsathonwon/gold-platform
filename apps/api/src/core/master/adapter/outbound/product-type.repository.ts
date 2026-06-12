import { Database, DrizzleClient, RepositoryError } from "../../../../infrastructure/db/client.js";
import { productTypes } from "../../../../infrastructure/db/schema/master.schema.js";
import { ForViewProductType, ProductTypeNotFound } from "../../port/product-type.port.js";
import { Effect } from "effect";
import { eq } from "drizzle-orm";

class ProductTypeRepository implements ForViewProductType {
    constructor(private readonly db: Database) { }

    listProductTypes() {
        return Effect.tryPromise({
            try: () => this.db.select().from(productTypes).execute(),
            catch: () => new RepositoryError({ message: "cannot list product types" }),
        });
    }

    findProductTypeById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(productTypes).where(eq(productTypes.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find product type id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) => {
                if (res.length !== 1) return Effect.fail(new ProductTypeNotFound());
                return Effect.succeed(res[0]);
            })
        );
    }
}

export const makeProductTypeRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new ProductTypeRepository(db);
});
