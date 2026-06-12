import { TApp } from "../../../infrastructure/runtime.js";
import { makeBranchRepository } from "../adapter/outbound/branch.repository.js";
import { BranchRepository, ForBranchUseCase } from "../port/branch.port.js";
import { Effect, Layer } from "effect";

export class BranchUseCase implements ForBranchUseCase {
    private readonly _repo = Layer.scoped(BranchRepository, makeBranchRepository);

    constructor(private readonly runtime: TApp) { }

    listBranches() {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* BranchRepository;
                return yield* repo.listBranches();
            }).pipe(Effect.provide(this._repo))
        );
    }

    findBranchById(id: string) {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* BranchRepository;
                return yield* repo.findBranchById(id);
            }).pipe(Effect.provide(this._repo))
        );
    }
}
