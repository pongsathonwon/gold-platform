import { makeSupplierRepository } from "../adapter/outbound/supplier.repository.js";
import { SupplierRepository } from "../port/supplier.port.js";
import { Effect, Layer } from "effect";

const supplierLive = Layer.scoped(SupplierRepository, makeSupplierRepository);

export const listSuppliers = () =>
    Effect.gen(function* () {
        const repo = yield* SupplierRepository;
        return yield* repo.listSuppliers();
    }).pipe(Effect.provide(supplierLive))

export const findSupplierById = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* SupplierRepository;
        return yield* repo.findSupplierById(id);
    }).pipe(Effect.provide(supplierLive))

export const findSupplierProductTypes = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* SupplierRepository;
        return yield* repo.findSupplierProductTypes(id);
    }).pipe(Effect.provide(supplierLive))

export const findSupplierBrands = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* SupplierRepository;
        return yield* repo.findSupplierBrands(id);
    }).pipe(Effect.provide(supplierLive))
