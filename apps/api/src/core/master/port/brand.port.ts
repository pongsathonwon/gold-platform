import { Context, Data, Effect } from "effect";
import { GoldBrand } from "../../../infrastructure/db/schema/master.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

export class BrandNotFound extends Data.TaggedError("BrandNotFound") {}

export interface ForViewBrand {
    listBrands(): Effect.Effect<GoldBrand[], RepositoryError>
    findBrandById(id: string): Effect.Effect<GoldBrand, RepositoryError | BrandNotFound>
}

export class BrandRepository extends Context.Tag("BrandRepository")<BrandRepository, ForViewBrand>() {}
