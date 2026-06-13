import { makeBranchRepository } from "../adapter/outbound/branch.repository.js";
import { BranchRepository } from "../port/branch.port.js";
import { Effect, Layer } from "effect";

const branchLive = Layer.scoped(BranchRepository, makeBranchRepository);

export const listBranches = () =>
    Effect.gen(function* () {
        const repo = yield* BranchRepository;
        return yield* repo.listBranches();
    }).pipe(Effect.provide(branchLive))

export const findBranchById = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* BranchRepository;
        return yield* repo.findBranchById(id);
    }).pipe(Effect.provide(branchLive))
