import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { RETAIL_SELL_NOTE_REQUIRED, todayBusinessDate } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq,
    InvalidTransitionError, ListFilter, NoteRequiredError, RetailSellRepository,
} from "../port/retail-sell.port.js";
import { makeRetailSellRepository } from "../adapter/retail-sell.repository.js";
import { resolveMeasuredQuantity } from "../../../infrastructure/quantity.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";

const retailSellLive = Layer.effect(RetailSellRepository, makeRetailSellRepository);

/**
 * A retail sell is the shop selling gold to a customer at the counter, written up after the fact.
 *
 * It moves no inventory, and this is a deliberate reversal: the previous version decremented stock
 * on `CONFIRMED → SHIPPED`. Shipping is deferred, so that transition became unreachable and the
 * decrement with it — leaving live code that moved gold down a path nothing could take. Stock is
 * adjusted manually through /inventory/gain|loss on both retail sides, symmetrically.
 */
export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        const id = randomUUID();
        const now = new Date();
        const transactionDate = req.transactionDate ?? todayBusinessDate(now);

        /**
         * `resolveMeasuredQuantity`, not `resolveQuantity`: what left the counter weighs what it
         * weighs. The pairing's min/step rules describe what can be *ordered* from a supplier —
         * 96.5% bar in multiples of 5 GB — and applying them here would refuse a real trade that
         * already happened. The pairing itself is still looked up, so an impossible product/purity
         * combination is refused and the weight is read in that pairing's unit (kg or gold baht).
         */
        const { weightGb, weightGm, conversionFactor } =
            yield* resolveMeasuredQuantity(req.productTypeId, req.purityId, req.weight);

        const transaction = yield* repo.createTransaction({
            id,
            branchCode: req.branchCode,
            purityId: req.purityId,
            productTypeId: req.productTypeId,
            brandId: null,
            weightGb,
            weightGm,
            conversionFactor,
            pricePerGb: req.pricePerGb,
            // Gold value only. ค่าบล็อค rides alongside, so the price-per-gold-baht average reads
            // spread rather than fee and stays comparable with wholesale.
            totalAmount: weightGb * req.pricePerGb,
            operationFee: req.operationFee ?? null,
            transactionDate,
            settlementPeriod: resolveSettlementPeriodOn(transactionDate),
            // Straight to CONFIRMED. There was never a draft — the trade happened before anyone
            // opened the form — and logging one would put an event in the audit trail that no one
            // performed.
            currentStatus: 'CONFIRMED',
            source: 'MANUAL',
            notes: req.notes ?? null,
            recordedBy: req.recordedBy,
            recordedAt: now,
        });

        yield* repo.createStatus({
            id: randomUUID(),
            transactionId: id,
            status: 'CONFIRMED',
            note: null,
            createdBy: req.recordedBy,
            createdAt: now,
        });

        return transaction;
    }).pipe(Effect.provide(retailSellLive))

/**
 * The only move a confirmed write-up has is being voided, and voiding has to say why: the row
 * already counted toward a week's figures, and "why is this week's average different" is not
 * answerable from a status alone.
 */
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

        if (RETAIL_SELL_NOTE_REQUIRED.includes(req.toStatus) && !req.note?.trim()) {
            return yield* Effect.fail(new NoteRequiredError({ status: req.toStatus }));
        }

        // No inventory hook on either side of this call — retail touches no pool.
        yield* repo.updateCurrentStatus(transaction.id, req.toStatus);
        yield* repo.createStatus({
            id: randomUUID(),
            transactionId: transaction.id,
            status: req.toStatus,
            note: req.note ?? null,
            createdBy: req.updatedBy,
            createdAt: new Date(),
        });

        return { currentStatus: req.toStatus };
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

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(retailSellLive))
