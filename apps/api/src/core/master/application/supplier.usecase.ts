import { TApp } from "../../../infrastructure/runtime.js";
import { makeSupplierRepository } from "../adapter/supplier.repository.js";
import { ForSupplierUseCase, SupplierRepository } from "../port/supplier.port.js";
import { Effect, Layer } from "effect";

export class SupplierUseCase implements ForSupplierUseCase {
    private readonly _repo = Layer.scoped(SupplierRepository, makeSupplierRepository);

    constructor(private readonly runtime: TApp) {}

    listSuppliers() {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* SupplierRepository;
                return yield* repo.listSuppliers();
            }).pipe(Effect.provide(this._repo))
        );
    }

    findSupplierById(id: string) {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* SupplierRepository;
                return yield* repo.findSupplierById(id);
            }).pipe(Effect.provide(this._repo))
        );
    }

    findSupplierProductTypes(id: string) {
        return this.runtime.runPromiseExit(
            Effect.gen(function* () {
                const repo = yield* SupplierRepository;
                return yield* repo.findSupplierProductTypes(id);
            }).pipe(Effect.provide(this._repo))
        );
    }
}
