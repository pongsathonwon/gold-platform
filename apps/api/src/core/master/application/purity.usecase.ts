import { makePurityRepository } from "../adapter/outbound/purity.repository.js";
import { PurityRepository } from "../port/purity.port.js";
import { Effect, Layer } from "effect";

const purityLive = Layer.scoped(PurityRepository, makePurityRepository);

export const listPurities = () =>
    Effect.gen(function* () {
        const repo = yield* PurityRepository;
        return yield* repo.listPurities();
    }).pipe(Effect.provide(purityLive))

export const findPurityById = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* PurityRepository;
        return yield* repo.findPurityById(id);
    }).pipe(Effect.provide(purityLive))
