import { TApp } from "../../../infrastructure/runtime.js";
import { makeProductTypeRepository } from "../adapter/outbound/product-type.repository.js";
import { ForProductTypeUseCase, ProductTypeRepository } from "../port/product-type.port.js";
import { Effect, Layer } from "effect";

export class ProductTypeUseCase implements ForProductTypeUseCase {
    private readonly _repo = Layer.scoped(ProductTypeRepository, makeProductTypeRepository);

    constructor(private readonly runtime: TApp) { }

    listProductTypes() {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* ProductTypeRepository;
                return yield* repo.listProductTypes();
            }).pipe(Effect.provide(this._repo))
        );
    }

    findProductTypeById(id: string) {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* ProductTypeRepository;
                return yield* repo.findProductTypeById(id);
            }).pipe(Effect.provide(this._repo))
        );
    }
}
