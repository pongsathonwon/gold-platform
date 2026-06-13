import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq,
    InvalidTransitionError, RetailBuyRepository,
} from "../port/retail-buy.port.js";
import { makeRetailBuyRepository } from "../adapter/retail-buy.repository.js";

const retailBuyLive = Layer.effect(RetailBuyRepository, makeRetailBuyRepository);

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        const id = randomUUID();

        const transaction = yield* repo.createTransaction({
            id,
            buyNumb: req.buyNumb,
            branchCode: req.branchCode,
            custCode: req.custCode,
            emplCode: req.emplCode,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            brandText: req.brandText,
            sizeText: req.sizeText,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            conversionFactor: req.conversionFactor,
            pricePerGb: req.pricePerGb,
            goldPriceSnapshot: req.goldPriceSnapshot,
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
    }).pipe(Effect.provide(retailBuyLive))

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        const allowed = allowedTransitions[transaction.currentStatus];
        if (!allowed.includes(req.toStatus)) {
            return yield* Effect.fail(new InvalidTransitionError({
                from: transaction.currentStatus,
                to: req.toStatus,
            }));
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
    }).pipe(Effect.provide(retailBuyLive))

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(retailBuyLive))

export const listTransactions = (req: { currentStatus?: string; settlementPeriod?: string }) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        return yield* repo.listTransactions(req as any);
    }).pipe(Effect.provide(retailBuyLive))
