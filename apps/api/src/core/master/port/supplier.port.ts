import { Context, Data, Effect } from "effect";
import { ProductType, Supplier } from "../../../infrastructure/db/schema/master.schema.js";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TErrorKey } from "../../../infrastructure/http/errors.js";

export class SupplierNotFound extends Data.TaggedError("SupplierNotFound") {}

type PossibleError = RepositoryError

export interface ForViewSupplier {
    listSuppliers(): Effect.Effect<Supplier[], PossibleError | TBaseError>
    findSupplierById(id: string): Effect.Effect<Supplier, PossibleError | SupplierNotFound | TBaseError>
    findSupplierProductTypes(id: string): Effect.Effect<ProductType[], PossibleError | SupplierNotFound | TBaseError>
}

export class SupplierRepository extends Context.Tag("SupplierRepository")<SupplierRepository, ForViewSupplier>() {}

export interface ForSupplierUseCase {
    listSuppliers(): AppReturnShape<Supplier[], PossibleError | TBaseError>
    findSupplierById(id: string): AppReturnShape<Supplier, PossibleError | SupplierNotFound | TBaseError>
    findSupplierProductTypes(id: string): AppReturnShape<ProductType[], PossibleError | SupplierNotFound | TBaseError>
}

export type SupplierErrorTag = TErrorKey<SupplierNotFound>
