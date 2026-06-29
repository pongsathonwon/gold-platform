import { makeProductTypeRepository } from "../adapter/outbound/product-type.repository.js";
import { ProductTypeRepository } from "../port/product-type.port.js";
import { Effect, Layer } from "effect";

const productTypeLive = Layer.scoped(ProductTypeRepository, makeProductTypeRepository);

export const listProductTypes = () =>
    Effect.gen(function* () {
        const repo = yield* ProductTypeRepository;
        return yield* repo.listProductTypes();
    }).pipe(Effect.provide(productTypeLive))

export const findProductTypeById = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* ProductTypeRepository;
        return yield* repo.findProductTypeById(id);
    }).pipe(Effect.provide(productTypeLive))

export const findProductTypePurities = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* ProductTypeRepository;
        return yield* repo.findProductTypePurities(id);
    }).pipe(Effect.provide(productTypeLive))
