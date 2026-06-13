import { Context, Data, Effect } from "effect";
import { ProductType, Supplier } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class SupplierNotFound extends Data.TaggedError("SupplierNotFound") {}

export interface ForViewSupplier {
    listSuppliers(): Effect.Effect<Supplier[], RepositoryError>
    findSupplierById(id: string): Effect.Effect<Supplier, RepositoryError | SupplierNotFound>
    findSupplierProductTypes(id: string): Effect.Effect<ProductType[], RepositoryError | SupplierNotFound>
}

export class SupplierRepository extends Context.Tag("SupplierRepository")<SupplierRepository, ForViewSupplier>() {}
