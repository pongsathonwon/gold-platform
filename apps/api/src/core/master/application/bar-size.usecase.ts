import { makeBarSizeRepository } from "../adapter/outbound/bar-size.repository.js";
import { BarSizeRepository } from "../port/bar-size.port.js";
import { Effect, Layer } from "effect";

const barSizeLive = Layer.scoped(BarSizeRepository, makeBarSizeRepository);

export const listBarSizes = () => Effect.gen(function* () {
    const repo = yield* BarSizeRepository;
    return yield* repo.listBarSizes();
}).pipe(Effect.provide(barSizeLive))

export const findBarSizeById = (id: string) => Effect.gen(function* () {
    const repo = yield* BarSizeRepository;
    return yield* repo.findBarSizeById(id);
}).pipe(Effect.provide(barSizeLive))

