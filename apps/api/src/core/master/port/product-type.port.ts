import { Context, Data, Effect } from "effect";
import { ProductType } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class ProductTypeNotFound extends Data.TaggedError("ProductTypeNotFound") {}

export interface ProductTypePurityRow {
    purityId: string
    label: string
    percent: number
    inputUnit: "kg" | "gb"
    minQuantity: number
    allowedValues: number[] | null
}

export interface ForViewProductType {
    listProductTypes(): Effect.Effect<ProductType[], RepositoryError>
    findProductTypeById(id: string): Effect.Effect<ProductType, RepositoryError | ProductTypeNotFound>
    findProductTypePurities(id: string): Effect.Effect<ProductTypePurityRow[], RepositoryError>
}

export class ProductTypeRepository extends Context.Tag("ProductTypeRepository")<ProductTypeRepository, ForViewProductType>() {}
