import { TApp } from "../../../infrastructure/runtime.js";
import { makeBrandRepository } from "../adapter/outbound/brand.repository.js";
import { BrandRepository, ForBrandUseCase } from "../port/brand.port.js";
import { Effect, Layer } from "effect";

export class BrandUseCase implements ForBrandUseCase {
    private readonly _repo = Layer.scoped(BrandRepository, makeBrandRepository);

    constructor(private readonly runtime: TApp) { }

    listBrands() {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* BrandRepository;
                return yield* repo.listBrands();
            }).pipe(Effect.provide(this._repo))
        );
    }

    findBrandById(id: string) {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* BrandRepository;
                return yield* repo.findBrandById(id);
            }).pipe(Effect.provide(this._repo))
        );
    }
}
