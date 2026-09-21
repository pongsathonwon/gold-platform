import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { roundMoney, BrandSplit, RETAIL_BUY_NOTE_REQUIRED, todayBusinessDate } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq, INVENTORY_STATUS,
    InvalidTransitionError, ListFilter, NoteRequiredError, REFERENCE_TYPE, RetailBuyRepository,
} from "../port/retail-buy.port.js";
import { makeRetailBuyRepository } from "../adapter/retail-buy.repository.js";
import { RetailBuyTransactionShape } from "../../../infrastructure/db/schema/retail-buy.schema.js";
import { findBrandSplitByReference, incrementSplit } from "../../inventory/application/inventory.usecase.js";
import { resolveMeasuredQuantity } from "../../../infrastructure/quantity.js";
import { apportionCost, resolveRetailBrandSplit } from "../../../infrastructure/brand-split.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";

const retailBuyLive = Layer.effect(RetailBuyRepository, makeRetailBuyRepository);

// a customer's gold never enters the domestic pool, whatever the purity — only smelting makes
// domestic stock
const ORIGIN = 'foreign' as const

/**
 * A retail buy is the shop taking gold off a customer at the counter, written up after the fact.
 *
 * The write-up records the *trade* — what was paid, for how much metal, on which day — and moves
 * nothing. The gold enters stock on the one move that follows, `STOCKED`, at this transaction's own
 * cost. Keeping the two apart is what lets a whole afternoon of backdated write-ups be entered
 * first and put on the books second, and what makes a void before stocking a pure log entry.
 */
export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        const id = randomUUID();
        const now = new Date();
        const transactionDate = req.transactionDate ?? todayBusinessDate(now);

        /**
         * `resolveMeasuredQuantity`, not `resolveQuantity`: a customer's gold weighs what it weighs.
         * The pairing's min/step rules describe what can be *ordered* from a supplier — 96.5% bar in
         * multiples of 5 GB — and applying them here would refuse a real trade that already happened.
         * The pairing itself is still looked up, so an impossible product/purity combination is
         * refused and the weight is read in that pairing's unit (kg or gold baht).
         */
        const { weightGb, weightGm, conversionFactor } =
            yield* resolveMeasuredQuantity(req.productTypeId, req.purityId, req.weight);

        const transaction = yield* repo.createTransaction({
            id,
            branchCode: req.branchCode,
            purityId: req.purityId,
            productTypeId: req.productTypeId,
            // brand is recorded when the gold is put away, as a split across pools in the ledger
            brandId: null,
            weightGb,
            weightGm,
            conversionFactor,
            pricePerGb: req.pricePerGb,
            // Gold value only. The fee rides alongside so this stays comparable with the wholesale
            // domains, which have no fees at all.
            totalAmount: roundMoney(weightGb * req.pricePerGb),
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
    }).pipe(Effect.provide(retailBuyLive))

/**
 * Puts the customer's gold on the books.
 *
 * **What enters is the transaction's weight, at the transaction's cost.** `totalAmount` — gold
 * value only, the fee stays out — follows the metal into the pools, apportioned by weight with the
 * last line absorbing the rounding so the pools reconcile to the write-up exactly. This is what
 * replaces the pooled manual gain that used to stand in for a day's counter buys: each trade now
 * carries its own price into the average.
 *
 * **It takes the brand split**, and this is the only place a buy records brand at all. The
 * operator names how much carried each stamp — with one stamped brand on the books that is
 * "ฮั่วเซ่งเฮง + อื่นๆ" — and the fungible pool takes whatever they do not name, by subtraction. A
 * split can decide which pools move and never how much does: 20 baht can book 10 + 10 or 5 + 15,
 * and cannot book 21.
 *
 * Runs before the status row is written, so a refused split leaves the write-up `CONFIRMED` rather
 * than logging a move that never happened.
 */
const stockGoods = (
    transaction: RetailBuyTransactionShape,
    actor: string,
    brandSplit: BrandSplit | undefined,
) =>
    Effect.gen(function* () {
        const split = yield* resolveRetailBrandSplit({
            purityId: transaction.purityId,
            conversionFactor: transaction.conversionFactor,
            weightGb: transaction.weightGb,
            weightGm: transaction.weightGm,
            requested: brandSplit ?? [],
        });

        yield* incrementSplit({
            purityId: transaction.purityId,
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            brands: apportionCost(split, transaction.totalAmount, transaction.weightGb),
            referenceType: REFERENCE_TYPE,
            referenceId: transaction.id,
            movedBy: actor,
        });
    })

/**
 * Two moves from a confirmed write-up: put the gold away, or void it.
 *
 * Voiding has to say why — the row already counted toward a week's figures, and "why is this
 * week's average different" is not answerable from a status alone. It is possible only until the
 * gold is on the books: `STOCKED` has no exit, and a stocked write-up that turns out wrong is
 * corrected through a manual stock loss, as a checked wholesale delivery is.
 */
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

        if (RETAIL_BUY_NOTE_REQUIRED.includes(req.toStatus) && !req.note?.trim()) {
            return yield* Effect.fail(new NoteRequiredError({ status: req.toStatus }));
        }

        // the one move that touches stock, and it runs first: a movement that fails leaves the
        // write-up where it was rather than recording a step the vault never saw
        if (req.toStatus === INVENTORY_STATUS) {
            yield* stockGoods(transaction, req.updatedBy, req.brandSplit);
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

        return { currentStatus: req.toStatus };
    }).pipe(Effect.provide(retailBuyLive))

// The brand split comes off the movement ledger rather than a column, because that is where it
// was written — before STOCKED there is nothing to report, and after it the ledger and the
// balances are the same rows.
export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        const [transaction, statuses, brandSplit] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
            findBrandSplitByReference(REFERENCE_TYPE, id),
        ]);
        return { transaction, statuses, brandSplit };
    }).pipe(Effect.provide(retailBuyLive))

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* RetailBuyRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(retailBuyLive))
