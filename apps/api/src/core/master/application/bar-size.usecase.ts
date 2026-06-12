import { TApp } from "../../../infrastructure/runtime.js";
import { makeBarSizeRepository } from "../adapter/bar-size.repository.js";
import { BarSizeRepository, ForBarSizeUseCase } from "../port/bar-size.port.js";
import { Effect, Layer } from "effect";

export class BarSizeUseCase implements ForBarSizeUseCase {
    private readonly _repo = Layer.scoped(BarSizeRepository, makeBarSizeRepository);

    constructor(private readonly runtime: TApp) {}

    listBarSizes() {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* BarSizeRepository;
                return yield* repo.listBarSizes();
            }).pipe(Effect.provide(this._repo))
        );
    }

    findBarSizeById(id: string) {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* BarSizeRepository;
                return yield* repo.findBarSizeById(id);
            }).pipe(Effect.provide(this._repo))
        );
    }
}
