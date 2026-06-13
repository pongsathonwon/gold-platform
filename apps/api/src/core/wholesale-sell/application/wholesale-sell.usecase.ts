import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq,
    InvalidTransitionError, WholeSellRepository,
} from "../port/wholesale-sell.port.js";
import { makeWholeSellRepository } from "../adapter/wholesale-sell.repository.js";
import { decrement } from "../../inventory/application/inventory.usecase.js";
import { resolveWeights } from "../../../infrastructure/weight.js";

const wholeSellLive = Layer.effect(WholeSellRepository, makeWholeSellRepository);

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const id = randomUUID();
        const { weightGb, weightGm, conversionFactor } = yield* resolveWeights(req.purityId, req.weight);

        const transaction = yield* repo.createTransaction({
            id,
            supplierId: req.supplierId,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb,
            weightGm,
            conversionFactor,
            pricePerGb: req.pricePerGb,
            totalAmount: weightGb * req.pricePerGb,
            settlementPeriod: req.settlementPeriod,
            currentStatus: 'DRAFT',
            recordedBy: req.recordedBy,
            recordedAt: new Date(),
        });

        yield* repo.createStatus({
            id: randomUUID(),
            transactionId: id,
            status: 'DRAFT',
            note: null,
            createdBy: req.recordedBy,
            createdAt: new Date(),
        });

        return transaction;
    }).pipe(Effect.provide(wholeSellLive))

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        const allowed = allowedTransitions[transaction.currentStatus];
        if (!allowed.includes(req.toStatus)) {
            return yield* Effect.fail(new InvalidTransitionError({
                from: transaction.currentStatus,
                to: req.toStatus,
            }));
        }

        // inventory decrement fires exactly once — when gold physically leaves
        if (transaction.currentStatus === 'CONFIRMED' && req.toStatus === 'SHIPPED') {
            yield* decrement({
                purityId: transaction.purityId,
                brandId: transaction.brandId,
                productTypeId: transaction.productTypeId,
                weightGb: transaction.weightGb,
                weightGm: transaction.weightGm,
                referenceType: 'WHOLESALE_SELL',
                referenceId: transaction.id,
                movedBy: req.updatedBy,
            });
        }

        yield* repo.updateCurrentStatus(transaction.id, req.toStatus);
        yield* repo.createStatus({
            id: randomUUID(),
            transactionId: transaction.id,
            status: req.toStatus,
            note: req.note ?? null,
            createdBy: req.updatedBy,
            createdAt: new Date(),
        });
    }).pipe(Effect.provide(wholeSellLive))

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(wholeSellLive))

export const listTransactions = (req: { currentStatus?: string; settlementPeriod?: string }) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        return yield* repo.listTransactions(req as any);
    }).pipe(Effect.provide(wholeSellLive))
