import { Context, Data, Effect } from "effect";
import { GoldBrand, ProductType, Supplier } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class SupplierNotFound extends Data.TaggedError("SupplierNotFound") {}

export interface ForViewSupplier {
    listSuppliers(): Effect.Effect<Supplier[], RepositoryError>
    findSupplierById(id: string): Effect.Effect<Supplier, RepositoryError | SupplierNotFound>
    findSupplierProductTypes(id: string): Effect.Effect<ProductType[], RepositoryError | SupplierNotFound>
    // The brands this supplier deals in — the enterable lines of a brand split, and for a
    // brandLock supplier the single brand that takes the whole weight. Registration is what keeps
    // the split UI to the handful of stamps a given supplier can actually send.
    findSupplierBrands(id: string): Effect.Effect<GoldBrand[], RepositoryError | SupplierNotFound>
}

export class SupplierRepository extends Context.Tag("SupplierRepository")<SupplierRepository, ForViewSupplier>() {}
