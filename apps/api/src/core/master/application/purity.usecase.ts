import { TApp, } from "../../../infrastructure/runtime.js";
import { makePurityRepository } from "../adapter/outbound/purity.repository.js";
import { ForPurityUseCase, PurityRepository } from "../port/purity.port.js";
import { Effect, Layer } from "effect";




export class PurityUserCase implements ForPurityUseCase {
    private readonly _repo = Layer.scoped(PurityRepository, makePurityRepository);

    constructor(private readonly runtime: TApp) { }

    listPurities() {
        return this.runtime.runPromiseExit(Effect.gen(function* () {
            const repo = yield* PurityRepository
            return yield* repo.listPurities()
        }).pipe(Effect.provide(this._repo)))
    }
    findPurityById(id: string) {
        return this.runtime.runPromiseExit(Effect.gen(function* () {
            const repo = yield* PurityRepository
            return yield* repo.findPurityById(id)
        }).pipe(Effect.provide(this._repo)))
    }
}