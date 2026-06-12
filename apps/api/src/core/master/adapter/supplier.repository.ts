import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import { productTypes, suppliers, supplierProductTypes } from "../../../infrastructure/db/schema/master.schema.js";
import { ForViewSupplier, SupplierNotFound } from "../port/supplier.port.js";
import { Effect } from "effect";
import { eq } from "drizzle-orm";

class SupplierRepository implements ForViewSupplier {
    constructor(private readonly db: Database) {}

    listSuppliers() {
        return Effect.tryPromise({
            try: () => this.db.select().from(suppliers).execute(),
            catch: () => new RepositoryError({ message: "cannot list suppliers" }),
        });
    }

    findSupplierById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(suppliers).where(eq(suppliers.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find supplier id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) => {
                if (res.length !== 1) return Effect.fail(new SupplierNotFound());
                return Effect.succeed(res[0]);
            })
        );
    }

    findSupplierProductTypes(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(suppliers).where(eq(suppliers.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot verify supplier id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) => {
                if (res.length !== 1) return Effect.fail(new SupplierNotFound());
                return Effect.succeed(res[0]);
            }),
            Effect.flatMap(() =>
                Effect.tryPromise({
                    try: () =>
                        this.db
                            .select({ id: productTypes.id, productType: productTypes.productType, supplierTradeable: productTypes.supplierTradeable, active: productTypes.active })
                            .from(supplierProductTypes)
                            .innerJoin(productTypes, eq(supplierProductTypes.productTypeId, productTypes.id))
                            .where(eq(supplierProductTypes.supplierId, id))
                            .execute(),
                    catch: () => new RepositoryError({ message: `cannot find product types for supplier id: ${id}` }),
                })
            )
        );
    }
}

export const makeSupplierRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new SupplierRepository(db);
});
