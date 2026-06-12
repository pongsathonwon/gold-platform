import { Context, Data, Effect } from "effect";
import { ProductType } from "../../../infrastructure/db/schema/master.schema.js";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TErrorKey } from "../../../infrastructure/http/errors.js";

export class ProductTypeNotFound extends Data.TaggedError("ProductTypeNotFound") {}

type PossibleError = RepositoryError

export interface ForViewProductType {
    listProductTypes(): Effect.Effect<ProductType[], PossibleError | TBaseError>
    findProductTypeById(id: string): Effect.Effect<ProductType, PossibleError | ProductTypeNotFound | TBaseError>
}

export class ProductTypeRepository extends Context.Tag("ProductTypeRepository")<ProductTypeRepository, ForViewProductType>() {}

export interface ForProductTypeUseCase {
    listProductTypes(): AppReturnShape<ProductType[], PossibleError | TBaseError>
    findProductTypeById(id: string): AppReturnShape<ProductType, PossibleError | ProductTypeNotFound | TBaseError>
}

export type ProductTypeErrorTag = TErrorKey<ProductTypeNotFound>
