import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq,
    GracePeriodExpiredError, InvalidTransitionError,
    GRACE_PERIOD_MS, ReceiveRepository,
} from "../port/receive.port.js";
import { makeReceiveRepository } from "../adapter/receive.repository.js";
import { increment } from "../../inventory/application/inventory.usecase.js";
import { resolveWeights } from "../../../infrastructure/weight.js";

const receiveLive = Layer.effect(ReceiveRepository, makeReceiveRepository);

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* ReceiveRepository;
        const id = randomUUID();
        const now = new Date();
        const { weightGb, weightGm, conversionFactor } = yield* resolveWeights(req.purityId, req.weight);

        const transaction = yield* repo.createTransaction({
            id,
            branchCode: req.branchCode,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb,
            weightGm,
            conversionFactor,
            totalCost: req.totalCost,
            settlementPeriod: req.settlementPeriod,
            currentStatus: 'RECEIVED',
            recordedBy: req.recordedBy,
            recordedAt: now,
        });

        yield* repo.createStatus({
            id: randomUUID(),
            transactionId: id,
            status: 'RECEIVED',
            note: null,
            createdBy: req.recordedBy,
            createdAt: now,
        });

        return transaction;
    }).pipe(Effect.provide(receiveLive))

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* ReceiveRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        const allowed = allowedTransitions[transaction.currentStatus];
        if (!allowed.includes(req.toStatus)) {
            return yield* Effect.fail(new InvalidTransitionError({
                from: transaction.currentStatus,
                to: req.toStatus,
            }));
        }

        // grace period check — cancel only allowed within 2 hours of the RECEIVED status entry
        if (req.toStatus === 'CANCELLED') {
            const receivedEntry = yield* repo.findReceivedStatusEntry(req.transactionId);
            const elapsed = Date.now() - receivedEntry.createdAt.getTime();
            if (elapsed > GRACE_PERIOD_MS) {
                return yield* Effect.fail(new GracePeriodExpiredError());
            }
        }

        // inventory increment fires exactly once — when document is confirmed
        if (req.toStatus === 'CONFIRMED') {
            yield* increment({
                purityId: transaction.purityId,
                brandId: transaction.brandId,
                origin: 'foreign',
                productTypeId: transaction.productTypeId,
                weightGb: transaction.weightGb,
                weightGm: transaction.weightGm,
                conversionFactor: transaction.conversionFactor,
                totalCost: transaction.totalCost,
                referenceType: 'RECEIVED',
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
    }).pipe(Effect.provide(receiveLive))

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* ReceiveRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(receiveLive))

export const listTransactions = (req: { currentStatus?: string; settlementPeriod?: string; branchCode?: string }) =>
    Effect.gen(function* () {
        const repo = yield* ReceiveRepository;
        return yield* repo.listTransactions(req as any);
    }).pipe(Effect.provide(receiveLive))
