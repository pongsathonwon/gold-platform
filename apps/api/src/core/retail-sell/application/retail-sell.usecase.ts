import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { roundMoney, BrandSplit, RETAIL_SELL_NOTE_REQUIRED, todayBusinessDate } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, CreateTransactionReq, INVENTORY_STATUS,
    InvalidTransitionError, ListFilter, NoteRequiredError, REFERENCE_TYPE, RetailSellRepository,
} from "../port/retail-sell.port.js";
import { makeRetailSellRepository } from "../adapter/retail-sell.repository.js";
import { RetailSellTransactionShape } from "../../../infrastructure/db/schema/retail-sell.schema.js";
import { decrementSplit, findBrandSplitByReference } from "../../inventory/application/inventory.usecase.js";
import { resolveMeasuredQuantity } from "../../../infrastructure/quantity.js";
import { resolveRetailBrandSplit } from "../../../infrastructure/brand-split.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";

const retailSellLive = Layer.effect(RetailSellRepository, makeRetailSellRepository);

// a counter sale never draws from the domestic pool, whatever the purity — only convert_out may
const ORIGIN = 'foreign' as const

/**
 * A retail sell is the shop selling gold to a customer at the counter, written up after the fact.
 *
 * The write-up records the *trade* and moves nothing. The gold leaves stock on the one move that
 * follows, `PACKED` — the same edge wholesale-sell counts, the moment the metal is out of the vault
 * and can no longer be sold to anyone else. That is the end of the line for now; the hand-over and
 * payment states come later and will move no stock when they do.
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
            // brand is recorded when the gold is pulled, as a split across pools in the ledger
            brandId: null,
            weightGb,
            weightGm,
            conversionFactor,
            pricePerGb: req.pricePerGb,
            // Gold value only. ค่าบล็อค rides alongside, so the price-per-gold-baht average reads
            // spread rather than fee and stays comparable with wholesale.
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
    }).pipe(Effect.provide(retailSellLive))

/**
 * Pulls the customer's gold from the vault.
 *
 * **What leaves is the transaction's weight; what it cost comes off each pool's live WAC** inside
 * the locked transaction. `totalAmount` is the sale price — revenue — not the cost basis being
 * removed, and the margin between the two is the period's business result, never booked here.
 *
 * **It takes the brand split**, the only place a sale records brand: which stamps go over the
 * counter is decided at the vault door out of what is on the shelf. Named brands divide the weight
 * and the fungible pool absorbs the residual, so the split can decide *which* pools are drawn down
 * and never *how much* leaves.
 *
 * Every named pool is decremented in one transaction. A pool short of stock fails
 * `InsufficientStockError` with nothing written anywhere and the sale still `CONFIRMED` — the move
 * runs before the status row for exactly that reason.
 */
const packGoods = (
    transaction: RetailSellTransactionShape,
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

        yield* decrementSplit({
            purityId: transaction.purityId,
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            // cost comes off the pool's live WAC, not from here
            brands: split.map((line) => ({ ...line, totalCost: 0 })),
            referenceType: REFERENCE_TYPE,
            referenceId: transaction.id,
            movedBy: actor,
        });
    })

/**
 * Two moves from a confirmed write-up: pull the gold, or void it.
 *
 * Voiding has to say why — the row already counted toward a week's figures — and it is possible
 * only until the gold leaves the vault. `PACKED` has no exit yet; a mistaken pack is corrected
 * through a manual stock gain until the hand-over states, and a return path, are built.
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

        // the one move that touches stock, and it runs first: a short pool leaves the sale where
        // it was rather than logging a pack the vault never performed
        if (req.toStatus === INVENTORY_STATUS) {
            yield* packGoods(transaction, req.updatedBy, req.brandSplit);
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
    }).pipe(Effect.provide(retailSellLive))

// The brand split comes off the movement ledger rather than a column, because that is where it
// was written — before PACKED there is nothing to report, and after it the ledger and the
// balances are the same rows.
export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        const [transaction, statuses, brandSplit] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
            findBrandSplitByReference(REFERENCE_TYPE, id),
        ]);
        return { transaction, statuses, brandSplit };
    }).pipe(Effect.provide(retailSellLive))

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* RetailSellRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(retailSellLive))
