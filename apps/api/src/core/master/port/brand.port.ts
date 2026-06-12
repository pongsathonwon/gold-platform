import { Context, Data, Effect } from "effect";
import { GoldBrand } from "../../../infrastructure/db/schema/master.schema.js";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TErrorKey } from "../../../infrastructure/http/errors.js";

export class BrandNotFound extends Data.TaggedError("BrandNotFound") {}

type PossibleError = RepositoryError

export interface ForViewBrand {
    listBrands(): Effect.Effect<GoldBrand[], PossibleError | TBaseError>
    findBrandById(id: string): Effect.Effect<GoldBrand, PossibleError | BrandNotFound | TBaseError>
}

export class BrandRepository extends Context.Tag("BrandRepository")<BrandRepository, ForViewBrand>() {}

export interface ForBrandUseCase {
    listBrands(): AppReturnShape<GoldBrand[], PossibleError | TBaseError>
    findBrandById(id: string): AppReturnShape<GoldBrand, PossibleError | BrandNotFound | TBaseError>
}

export type BrandErrorTag = TErrorKey<BrandNotFound>
