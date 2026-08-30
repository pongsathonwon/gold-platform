import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { roundMoney, BrandSplit, derivePricePerGb999, todayBusinessDate } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, BOT_CONFIRM_ACTOR, CONTESTED_STATUS,
    CreateTransactionReq, INVENTORY_STATUS, InvalidTransitionError, ListFilter,
    nextAutoConfirmAt, NOTE_REQUIRED_STATUSES, NotEditableError, NoteRequiredError,
    RETURN_STATUS, ReturnReason, ReturnReasonRequiredError, REVERSAL_STATUS,
    REVERSE_REFERENCE_TYPE, SETTLEMENT_STATUS, UpdateTransactionFields, UpdateTransactionReq,
    WholeSellRepository,
} from "../port/wholesale-sell.port.js";
import { makeWholeSellRepository } from "../adapter/wholesale-sell.repository.js";
import { WholeSellStatus, WholeSellTransactionShape } from "../../../infrastructure/db/schema/wholesale-sell.schema.js";
import {
    decrementSplit, findBrandSplitByReference, reverseDecrement,
} from "../../inventory/application/inventory.usecase.js";
import { findQuantityRule, resolveMeasuredQuantity, resolveQuantity } from "../../../infrastructure/quantity.js";
import { resolveBrandSplit } from "../../../infrastructure/brand-split.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";

const wholeSellLive = Layer.effect(WholeSellRepository, makeWholeSellRepository);

// a wholesale sale always draws from the foreign pool — the domestic pool is smelted stock and
// only convert_out may consume it
const ORIGIN = 'foreign' as const
const REFERENCE_TYPE = 'WHOLESALE_SELL'

// Which of the two recorded quotes applies. 99.9% gold (unitOfMeasure 'g') is priced off the
// 96.5% quote by the purity ratio — the operator enters one, the item's purity picks which.
const applicablePrice = (unitOfMeasure: 'g' | 'gb', pricePerGb965: number, pricePerGb999: number) =>
    unitOfMeasure === 'g' ? pricePerGb999 : pricePerGb965

// --- Commands ---

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const id = randomUUID();
        const now = new Date();
        // the day the deal happened, per the operator; today when they say nothing. `now` stays
        // the bookkeeping instant and goes to recordedAt untouched.
        const transactionDate = req.transactionDate ?? todayBusinessDate(now);

        // validates the productType/purity pairing and the sellable-quantity rule for it
        const { weightGb, weightGm, conversionFactor, unitOfMeasure } =
            yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);

        // the operator enters one price; the 99.9% quote is arithmetic off it, never re-typed
        const pricePerGb999 = derivePricePerGb999(req.pricePerGb965);
        const price = applicablePrice(unitOfMeasure, req.pricePerGb965, pricePerGb999);

        const transaction = yield* repo.createTransaction({
            id,
            supplierId: req.supplierId,
            purityId: req.purityId,
            productTypeId: req.productTypeId,
            weightGb,
            weightGm,
            conversionFactor,
            pricePerGb965: req.pricePerGb965,
            pricePerGb999,
            totalAmount: roundMoney(weightGb * price),
            actualWeightGb: null,
            actualWeightGm: null,
            actualAmount: null,
            settledAmount: null,
            returnReason: null,
            transactionDate,
            // callers never supply the period — it is derived from the day the deal happened and
            // frozen there, so a backdated sale lands in the period it belongs to
            settlementPeriod: resolveSettlementPeriodOn(transactionDate),
            currentStatus: 'CREATED',
            // informational: when the nightly job will sweep this up if nobody confirms it first.
            // Real time, not business date — the edit window closes at the next actual sweep.
            confirmDueAt: nextAutoConfirmAt(now),
            notes: req.notes ?? null,
            recordedBy: req.recordedBy,
            recordedAt: now,
        });

        yield* repo.createStatus({
            id: randomUUID(),
            transactionId: id,
            status: 'CREATED',
            note: null,
            createdBy: req.recordedBy,
            createdAt: now,
        });

        return transaction;
    }).pipe(Effect.provide(wholeSellLive))

/**
 * Edits are accepted only while the transaction is still CREATED. Confirmation is the lock —
 * whether it came from the nightly job, the manual bulk trigger, or a per-transaction confirm.
 */
export const updateTransaction = (req: UpdateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        if (transaction.currentStatus !== 'CREATED') {
            return yield* Effect.fail(new NotEditableError({
                id: transaction.id,
                currentStatus: transaction.currentStatus,
            }));
        }

        const fields: UpdateTransactionFields = {};
        if (req.supplierId !== undefined) fields.supplierId = req.supplierId;
        if (req.notes !== undefined) fields.notes = req.notes;

        // the date and its settlement period are one fact — correcting one without the other
        // would leave the transaction filed in a week it does not claim to belong to
        if (req.transactionDate !== undefined) {
            fields.transactionDate = req.transactionDate;
            fields.settlementPeriod = resolveSettlementPeriodOn(req.transactionDate);
        }

        // weight, purity, product type and price all feed weightGb/totalAmount — if any of them
        // moved, both the resolved weights and the amount are recomputed from the merged values
        const purityId = req.purityId ?? transaction.purityId;
        const productTypeId = req.productTypeId ?? transaction.productTypeId;
        const pricePerGb965 = req.pricePerGb965 ?? transaction.pricePerGb965;
        const pricePerGb999 = derivePricePerGb999(pricePerGb965);
        const pricingChanged =
            req.weight !== undefined || req.purityId !== undefined || req.productTypeId !== undefined ||
            req.pricePerGb965 !== undefined;

        if (pricingChanged) {
            // when the weight itself is unchanged it still has to be re-expressed in the target
            // pairing's input unit before re-resolving — for a kg pairing the stored weightGb is
            // not what the caller originally typed, so feeding it back in would silently rescale
            const rule = yield* findQuantityRule(productTypeId, purityId);
            const storedWeightInInputUnit =
                rule.inputUnit === 'kg' ? transaction.weightGm / 1000 : transaction.weightGb;
            const weight = req.weight ?? storedWeightInInputUnit;
            const { weightGb, weightGm, conversionFactor, unitOfMeasure } =
                yield* resolveQuantity(productTypeId, purityId, weight);

            fields.purityId = purityId;
            fields.productTypeId = productTypeId;
            fields.weightGb = weightGb;
            fields.weightGm = weightGm;
            fields.conversionFactor = conversionFactor;
            fields.pricePerGb965 = pricePerGb965;
            fields.pricePerGb999 = pricePerGb999;
            fields.totalAmount = roundMoney(weightGb * applicablePrice(unitOfMeasure, pricePerGb965, pricePerGb999));
        }

        return yield* repo.updateTransaction(transaction.id, fields);
    }).pipe(Effect.provide(wholeSellLive))

/**
 * Pulls the gold out of the vault and out of the books.
 *
 * **Packing takes no weight.** We boxed our own gold from our own vault, so there is no second,
 * independent measurement to capture — the only figure a caller could supply is the agreed weight
 * they already have, and the old equality check could therefore only ever reject a typo. The
 * agreed weight is what leaves.
 *
 * **It does take the brand split**, and this is the only place a sell records brand at all. Which
 * stamps go in the box is decided at the vault door out of what is actually on the shelf, not
 * months earlier when the deal was struck. A `brandLock` counterparty takes their one stamp and
 * the operator enters nothing.
 *
 * The split divides the agreed weight and the fungible pool absorbs the residual, so it can change
 * *which* pools are drawn down but never *how much* leaves.
 *
 * Every named pool is decremented in one transaction. A pool short of stock fails
 * `InsufficientStockError` with nothing written and nothing decremented anywhere, leaving the
 * transaction at CONFIRMED — a half-packed shipment would be worse than an unpacked one.
 */
const packGoods = (
    transaction: WholeSellTransactionShape,
    actor: string,
    brandSplit: BrandSplit | undefined,
) =>
    Effect.gen(function* () {
        const split = yield* resolveBrandSplit({
            supplierId: transaction.supplierId,
            purityId: transaction.purityId,
            conversionFactor: transaction.conversionFactor,
            weightGb: transaction.weightGb,
            weightGm: transaction.weightGm,
            requested: brandSplit ?? [],
        });

        // cost comes off each pool's live WAC inside the locked transaction — totalAmount is the
        // sale price, which is revenue, not the cost basis being removed
        yield* decrementSplit({
            purityId: transaction.purityId,
            // a sale never touches the domestic pool, whatever the purity — only convert_out may
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            brands: split.map((line) => ({ ...line, totalCost: 0 })),
            referenceType: REFERENCE_TYPE,
            referenceId: transaction.id,
            movedBy: actor,
        });
    })

/**
 * Puts the gold back. Reachable from PACKED, SHIPPED and DISPUTED — every state after the
 * decrement in which the shipment can still physically come home.
 *
 * The reversal is booked as its own movement rather than by editing the original: the ledger then
 * shows the gold leaving and coming back, which is what actually happened. Its own reference type
 * keeps the pair legible on the movements page.
 *
 * It needs no split of its own. A mixed shipment booked several movements under this reference,
 * and the reversal replays each one back into the pool it came out of — which is exactly why the
 * ledger, rather than a column, is where the split belongs.
 */
const returnGoods = (transaction: WholeSellTransactionShape, actor: string) =>
    reverseDecrement({
        originalReferenceType: REFERENCE_TYPE,
        originalReferenceId: transaction.id,
        reverseReferenceType: REVERSE_REFERENCE_TYPE,
        reverseReferenceId: transaction.id,
        movedBy: actor,
    })

/**
 * Records what the buyer says they weighed, on a move into DISPUTED.
 *
 * This is the one place a weight other than the agreed one is ever stored on a sell. It changes
 * no stock — the gold left at PACKED and is sitting with the buyer — it only puts their figure
 * on the record so the disagreement is documented in numbers rather than in prose.
 *
 * It resolves through `resolveMeasuredQuantity()`, not `resolveQuantity()`: the buyer's scale is
 * reporting what it read, so the sellable-quantity rules must not reject 11.95 GB against a
 * 12 GB deal as invalid input.
 */
const recordContestedWeight = (
    transaction: WholeSellTransactionShape,
    contestedWeight: number | undefined,
) =>
    Effect.gen(function* () {
        if (contestedWeight === undefined) return;
        const repo = yield* WholeSellRepository;

        const measured = yield* resolveMeasuredQuantity(
            transaction.productTypeId, transaction.purityId, contestedWeight,
        );
        const price = applicablePrice(
            measured.unitOfMeasure, transaction.pricePerGb965, transaction.pricePerGb999,
        );

        yield* repo.recordContestedWeights(transaction.id, {
            actualWeightGb: measured.weightGb,
            actualWeightGm: measured.weightGm,
            actualAmount: roundMoney(measured.weightGb * price),
        });
    })

// writes the append-only log entry and refreshes the write-through currentStatus cache
const applyStatus = (transactionId: string, status: WholeSellStatus, note: string | undefined, actor: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        yield* repo.updateCurrentStatus(transactionId, status);
        yield* repo.createStatus({
            id: randomUUID(),
            transactionId,
            status,
            note: note ?? null,
            createdBy: actor,
            createdAt: new Date(),
        });
    })

const assertTransitionAllowed = (
    transaction: WholeSellTransactionShape,
    to: WholeSellStatus,
    note: string | undefined,
    returnReason: ReturnReason | undefined,
) =>
    Effect.gen(function* () {
        const from = transaction.currentStatus;
        if (!allowedTransitions[from].includes(to)) {
            return yield* Effect.fail(new InvalidTransitionError({ from, to }));
        }
        // failure branches must record why — that reason is unrecoverable from anywhere else
        if (NOTE_REQUIRED_STATUSES.includes(to) && !note?.trim()) {
            return yield* Effect.fail(new NoteRequiredError({ status: to }));
        }
        if (to === RETURN_STATUS && returnReason === undefined) {
            return yield* Effect.fail(new ReturnReasonRequiredError({ id: transaction.id }));
        }
    })

/**
 * Runs whatever a transition owns beyond the log entry.
 *
 * Exactly two moves touch stock — `PACKED` takes it out, `RETURNED` puts it back — and two more
 * record a figure without moving anything: `DISPUTED` the buyer's weight, `PAID` what they
 * actually settled. All of them run before the status row is written, so a failure leaves the
 * transaction where it was rather than logging a move that never physically happened.
 */
const applyTransitionEffect = (
    transaction: WholeSellTransactionShape,
    req: Pick<AdvanceStatusReq, 'actualWeight' | 'settledAmount' | 'returnReason' | 'brandSplit'>,
    toStatus: WholeSellStatus,
    actor: string,
) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;

        if (toStatus === INVENTORY_STATUS) {
            yield* packGoods(transaction, actor, req.brandSplit);
            return;
        }
        // only a shipment that actually left needs putting back — a deal that dies before PACKED
        // never had its stock removed. RETURNED is unreachable from those states anyway; this
        // guard is what keeps that true if the transition map is ever widened.
        if (toStatus === REVERSAL_STATUS) {
            yield* returnGoods(transaction, actor);
            yield* repo.recordSettlement(transaction.id, { returnReason: req.returnReason });
            return;
        }
        // no stock moves, but the buyer's figure goes on the record
        if (toStatus === CONTESTED_STATUS) {
            yield* recordContestedWeight(transaction, req.actualWeight);
            return;
        }
        // clear a variance from a previous failed attempt when the retry settles exactly
        if (toStatus === SETTLEMENT_STATUS) {
            yield* repo.recordSettlement(transaction.id, { settledAmount: req.settledAmount ?? null });
        }
    })

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction, req.toStatus, req.note, req.returnReason);
        yield* applyTransitionEffect(transaction, req, req.toStatus, req.updatedBy);
        yield* applyStatus(transaction.id, req.toStatus, req.note, req.updatedBy);

        return { status: req.toStatus };
    }).pipe(Effect.provide(wholeSellLive))

/**
 * Bulk confirm — moves **every** transaction still sitting in CREATED to CONFIRMED. There is no
 * per-transaction deadline: this run is the cutoff, which is why a nightly schedule is what
 * decides when the day's deals lock. Identical to the wholesale-buy sweep.
 *
 * Two callers, distinguished only by the actor recorded in the log:
 *  - the nightly job, which passes no actor and is logged as `BOT-CONFIRM`
 *  - an operator hitting the manual trigger mid-day, logged under their own username
 *
 * Safe to call repeatedly — once a transaction leaves CREATED it stops matching.
 */
export const confirmAllCreated = (actor?: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const pending = yield* repo.listCreated();
        const by = actor ?? BOT_CONFIRM_ACTOR;
        const note = actor ? 'ยืนยันทั้งหมด (manual)' : 'ยืนยันอัตโนมัติรอบกลางคืน';

        for (const transaction of pending) {
            yield* applyStatus(transaction.id, 'CONFIRMED', note, by);
        }

        return { confirmed: pending.length, ids: pending.map((t) => t.id) };
    }).pipe(Effect.provide(wholeSellLive))

// --- Queries ---

// The brand split comes off the movement ledger rather than a column: before PACKED there is
// nothing to report, and after it the ledger and the balances are the same rows.
export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const [transaction, statuses, brandSplit] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
            findBrandSplitByReference(REFERENCE_TYPE, id),
        ]);
        return { transaction, statuses, brandSplit };
    }).pipe(Effect.provide(wholeSellLive))

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(wholeSellLive))
