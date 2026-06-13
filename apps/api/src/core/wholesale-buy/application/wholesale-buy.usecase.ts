import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq,
    InvalidTransitionError, WholeBuyRepository,
} from "../port/wholesale-buy.port.js";
import { makeWholeBuyRepository } from "../adapter/wholesale-buy.repository.js";
import { increment } from "../../inventory/application/inventory.usecase.js";

const wholeBuyLive = Layer.effect(WholeBuyRepository, makeWholeBuyRepository);

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const id = randomUUID();

        const transaction = yield* repo.createTransaction({
            id,
            supplierId: req.supplierId,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            conversionFactor: req.conversionFactor,
            pricePerGb: req.pricePerGb,
            totalAmount: req.weightGb * req.pricePerGb,
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
    }).pipe(Effect.provide(wholeBuyLive))

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        const allowed = allowedTransitions[transaction.currentStatus];
        if (!allowed.includes(req.toStatus)) {
            return yield* Effect.fail(new InvalidTransitionError({
                from: transaction.currentStatus,
                to: req.toStatus,
            }));
        }

        // inventory increment fires exactly once — when gold physically arrives
        if (transaction.currentStatus === 'CONFIRMED' && req.toStatus === 'RECEIVED') {
            yield* increment({
                sourceId: transaction.id,
                purityId: transaction.purityId,
                brandId: transaction.brandId,
                productTypeId: transaction.productTypeId,
                weightGb: transaction.weightGb,
                weightGm: transaction.weightGm,
                conversionFactor: transaction.conversionFactor,
                totalCost: transaction.totalAmount,
                referenceType: 'WHOLESALE_BUY',
                referenceId: transaction.id,
                createdBy: req.updatedBy,
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
    }).pipe(Effect.provide(wholeBuyLive))

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(wholeBuyLive))

export const listTransactions = (req: { currentStatus?: string; settlementPeriod?: string }) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        return yield* repo.listTransactions(req as any);
    }).pipe(Effect.provide(wholeBuyLive))
