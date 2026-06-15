import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq,
    InvalidTransitionError, RetailSellRepository,
} from "../port/retail-sell.port.js";
import { makeRetailSellRepository } from "../adapter/retail-sell.repository.js";
import { decrement } from "../../inventory/application/inventory.usecase.js";
import { resolveWeights } from "../../../infrastructure/weight.js";

const retailSellLive = Layer.effect(RetailSellRepository, makeRetailSellRepository);

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        const id = randomUUID();
        const { weightGb, weightGm, conversionFactor } = yield* resolveWeights(req.purityId, req.weight);

        const transaction = yield* repo.createTransaction({
            id,
            saleNumb: req.saleNumb,
            branchCode: req.branchCode,
            custCode: req.custCode,
            emplCode: req.emplCode,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            brandText: req.brandText,
            sizeText: req.sizeText,
            weightGb,
            weightGm,
            conversionFactor,
            pricePerGb: req.pricePerGb,
            goldPriceSnapshot: req.goldPriceSnapshot,
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
    }).pipe(Effect.provide(retailSellLive))

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        const allowed = allowedTransitions[transaction.currentStatus];
        if (!allowed.includes(req.toStatus)) {
            return yield* Effect.fail(new InvalidTransitionError({
                from: transaction.currentStatus,
                to: req.toStatus,
            }));
        }

        // inventory decrement fires when gold physically leaves — not before
        if (transaction.currentStatus === 'CONFIRMED' && req.toStatus === 'SHIPPED') {
            yield* decrement({
                purityId: transaction.purityId,
                brandId: transaction.brandId,
                origin: 'foreign',
                productTypeId: transaction.productTypeId,
                weightGb: transaction.weightGb,
                weightGm: transaction.weightGm,
                referenceType: 'RETAIL_SELL',
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
    }).pipe(Effect.provide(retailSellLive))

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(retailSellLive))

export const listTransactions = (req: { currentStatus?: string; settlementPeriod?: string; branchCode?: string }) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        return yield* repo.listTransactions(req as any);
    }).pipe(Effect.provide(retailSellLive))
