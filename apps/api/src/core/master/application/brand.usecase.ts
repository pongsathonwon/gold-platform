import { makeBrandRepository } from "../adapter/outbound/brand.repository.js";
import { BrandRepository } from "../port/brand.port.js";
import { Effect, Layer } from "effect";

const brandLive = Layer.scoped(BrandRepository, makeBrandRepository);

export const listBrands = () =>
    Effect.gen(function* () {
        const repo = yield* BrandRepository;
        return yield* repo.listBrands();
    }).pipe(Effect.provide(brandLive))

export const findBrandById = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* BrandRepository;
        return yield* repo.findBrandById(id);
    }).pipe(Effect.provide(brandLive))
