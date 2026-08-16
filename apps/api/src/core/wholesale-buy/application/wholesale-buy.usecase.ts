import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { BrandSplit, derivePricePerGb999 } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, BOT_CONFIRM_ACTOR, CONTESTED_STATUS,
    CreateTransactionReq, INVENTORY_STATUS, InvalidTransitionError, ListFilter,
    nextAutoConfirmAt, NOTE_REQUIRED_STATUSES, NotEditableError, NoteRequiredError,
    ReceiveAndStockReq, RETURN_STATUS, ReturnReason, ReturnReasonRequiredError,
    SETTLEMENT_STATUS, UpdateTransactionFields, UpdateTransactionReq, WholeBuyRepository,
} from "../port/wholesale-buy.port.js";
import { makeWholeBuyRepository } from "../adapter/wholesale-buy.repository.js";
import { WholeBuyStatus, WholeBuyTransactionShape } from "../../../infrastructure/db/schema/wholesale-buy.schema.js";
import { findBrandSplitByReference, incrementSplit } from "../../inventory/application/inventory.usecase.js";
import { findQuantityRule, resolveMeasuredQuantity, resolveQuantity } from "../../../infrastructure/quantity.js";
import { apportionCost, resolveBrandSplit } from "../../../infrastructure/brand-split.js";
import { resolveSettlementPeriod } from "../../../infrastructure/settlement.js";

const wholeBuyLive = Layer.effect(WholeBuyRepository, makeWholeBuyRepository);

// wholesale-buy always lands in the foreign pool — only smelting produces domestic stock
const ORIGIN = 'foreign' as const
const REFERENCE_TYPE = 'WHOLESALE_BUY'

// Which of the two recorded quotes applies. 99.9% gold (unitOfMeasure 'g') is priced off the
// 96.5% quote by the purity ratio — the operator enters both, the item's purity picks one.
const applicablePrice = (unitOfMeasure: 'g' | 'gb', pricePerGb965: number, pricePerGb999: number) =>
    unitOfMeasure === 'g' ? pricePerGb999 : pricePerGb965

// --- Commands ---

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const id = randomUUID();
        const now = new Date();

        // validates the productType/purity pairing and the orderable-quantity rule for it
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
            totalAmount: weightGb * price,
            actualWeightGb: null,
            actualWeightGm: null,
            actualAmount: null,
            settledAmount: null,
            returnReason: null,
            // callers never supply the period — it is derived from the recording time and frozen
            settlementPeriod: resolveSettlementPeriod(now),
            currentStatus: 'CREATED',
            // informational: when the nightly job will sweep this up if nobody confirms it first
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
    }).pipe(Effect.provide(wholeBuyLive))

/**
 * Edits are accepted only while the transaction is still CREATED. Confirmation is the lock —
 * whether it came from the nightly job, the manual bulk trigger, or a per-transaction confirm.
 */
export const updateTransaction = (req: UpdateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
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
            fields.totalAmount = weightGb * applicablePrice(unitOfMeasure, pricePerGb965, pricePerGb999);
        }

        return yield* repo.updateTransaction(transaction.id, fields);
    }).pipe(Effect.provide(wholeBuyLive))

/**
 * Accepts a delivery into stock.
 *
 * **Acceptance takes no weight.** It means "what arrived matches the document", so the ordered
 * weight is what enters inventory — and the only value a supplied figure could legally have held
 * was the number already on the order. A field that permits exactly one value carries no
 * information, and mistyping it used to divert a perfectly good delivery into `DISPUTED`.
 *
 * **It does take the brand split**, and this is the only place a buy records brand at all. What
 * stamp the gold carries is not something an order can state in advance — it is what turns up, and
 * from a supplier that is not brand-locked it is routinely a mix. So brand is not a check the
 * delivery can fail; it is an observation made when the metal is on the counter. A `brandLock`
 * supplier's single stamp takes all of it and the operator enters nothing.
 *
 * The split cannot change *how much* enters stock. It divides the agreed weight and the residual
 * falls to the fungible pool by subtraction, so the pools always sum back to the order.
 *
 * The check that matters still happens earlier and physically: at the door, against the document,
 * before custody transfers. A delivery whose weight or purity disagrees is refused outright
 * (`PAID → RETURNED`) and never reaches this path.
 */
const acceptIntoStock = (
    transaction: WholeBuyTransactionShape,
    actor: string,
    brandSplit: BrandSplit | undefined,
) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;

        // Clearing matters when resolving a dispute: a shipment contested at 14 and later accepted
        // must not keep showing the stale 14 as what arrived. Acceptance means it matched, so a
        // STOCKED transaction never carries a second weight. The DISPUTED entry in the status log
        // is where that history belongs, and it stays there.
        if (transaction.actualWeightGb !== null) {
            yield* repo.recordContestedWeights(transaction.id, {
                actualWeightGb: null, actualWeightGm: null, actualAmount: null,
            });
        }

        const split = yield* resolveBrandSplit({
            supplierId: transaction.supplierId,
            purityId: transaction.purityId,
            conversionFactor: transaction.conversionFactor,
            weightGb: transaction.weightGb,
            weightGm: transaction.weightGm,
            requested: brandSplit ?? [],
        });

        yield* incrementSplit({
            purityId: transaction.purityId,
            // wholesale-buy never produces domestic stock, whatever the purity — only smelting does
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            // what we paid follows the metal: each pool is credited its share of the order value,
            // with the last line absorbing the rounding so the pools reconcile to totalAmount
            brands: apportionCost(split, transaction.totalAmount, transaction.weightGb),
            referenceType: REFERENCE_TYPE,
            referenceId: transaction.id,
            movedBy: actor,
        });
    })

/**
 * Records the weight we say a delivery came to, on a move into DISPUTED.
 *
 * This is the one place on a buy where a weight other than the ordered one is stored, and the
 * only path on which a figure is worth typing at all — a dispute is meaningless without the
 * number being disputed.
 *
 * It resolves through `resolveMeasuredQuantity()`, not `resolveQuantity()`: a shipment coming to
 * 11.95 GB against a 12 GB order is a real short delivery, so the orderable-quantity rules must
 * not reject it as invalid input.
 */
const recordContestedWeight = (
    transaction: WholeBuyTransactionShape,
    contestedWeight: number | undefined,
) =>
    Effect.gen(function* () {
        if (contestedWeight === undefined) return;
        const repo = yield* WholeBuyRepository;

        const measured = yield* resolveMeasuredQuantity(
            transaction.productTypeId, transaction.purityId, contestedWeight,
        );
        const price = applicablePrice(
            measured.unitOfMeasure, transaction.pricePerGb965, transaction.pricePerGb999,
        );

        yield* repo.recordContestedWeights(transaction.id, {
            actualWeightGb: measured.weightGb,
            actualWeightGm: measured.weightGm,
            actualAmount: measured.weightGb * price,
        });
    })

// writes the append-only log entry and refreshes the write-through currentStatus cache
const applyStatus = (transactionId: string, status: WholeBuyStatus, note: string | undefined, actor: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
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
    transaction: WholeBuyTransactionShape,
    to: WholeBuyStatus,
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
        // the note says what happened in prose; the reason is what makes it countable
        if (to === RETURN_STATUS && returnReason === undefined) {
            return yield* Effect.fail(new ReturnReasonRequiredError({ id: transaction.id }));
        }
    })

/**
 * Runs whatever a transition owns beyond the log entry. Four moves carry something:
 *
 *  - `STOCKED`   accepts the delivery and increments inventory — the only stock movement here
 *  - `DISPUTED`  records the weight we contest, moving no stock
 *  - `PAID`      records what was actually paid, if it differed from the order
 *  - `RETURNED`  records why the shipment went back
 *
 * All of them run before the status row is written, so a failure leaves the transaction where it
 * was rather than logging a move that did not fully happen.
 */
const applyTransitionEffect = (
    transaction: WholeBuyTransactionShape,
    req: Pick<AdvanceStatusReq, 'actualWeight' | 'settledAmount' | 'returnReason' | 'brandSplit'>,
    toStatus: WholeBuyStatus,
    actor: string,
) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;

        if (toStatus === INVENTORY_STATUS) {
            yield* acceptIntoStock(transaction, actor, req.brandSplit);
            return;
        }
        if (toStatus === CONTESTED_STATUS) {
            yield* recordContestedWeight(transaction, req.actualWeight);
            return;
        }
        // null out an amount only when one is supplied — a retry after PAYMENT_FAILED that
        // settles exactly should clear a variance recorded by the failed attempt
        if (toStatus === SETTLEMENT_STATUS) {
            yield* repo.recordSettlement(transaction.id, { settledAmount: req.settledAmount ?? null });
            return;
        }
        if (toStatus === RETURN_STATUS) {
            yield* repo.recordSettlement(transaction.id, { returnReason: req.returnReason });
        }
    })

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction, req.toStatus, req.note, req.returnReason);
        yield* applyTransitionEffect(transaction, req, req.toStatus, req.updatedBy);
        yield* applyStatus(transaction.id, req.toStatus, req.note, req.updatedBy);

        return { status: req.toStatus };
    }).pipe(Effect.provide(wholeBuyLive))

/**
 * Receive and stock in one operator action — how the floor actually works, and how BU wants it to
 * stay: the person who accepts a delivery is the person who puts it away, and they would staff
 * that role rather than split it. Both status entries are still written, so separating the steps
 * later changes nothing about the history already recorded.
 *
 * No weight is taken. Reaching this call already means the delivery was checked against its
 * document at the door and accepted; one that failed that check never got this far. The brand
 * split is taken, because putting the gold away is the moment its stamps are known.
 */
export const receiveAndStock = (req: ReceiveAndStockReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction, 'RECEIVED', req.note, undefined);
        if (!allowedTransitions.RECEIVED.includes(INVENTORY_STATUS)) {
            return yield* Effect.fail(new InvalidTransitionError({ from: 'RECEIVED', to: INVENTORY_STATUS }));
        }

        yield* applyStatus(transaction.id, 'RECEIVED', req.note, req.updatedBy);
        yield* acceptIntoStock(transaction, req.updatedBy, req.brandSplit);
        yield* applyStatus(transaction.id, INVENTORY_STATUS, req.note, req.updatedBy);

        return { status: INVENTORY_STATUS };
    }).pipe(Effect.provide(wholeBuyLive))

/**
 * Bulk confirm — moves **every** transaction still sitting in CREATED to CONFIRMED. There is no
 * per-transaction deadline: this run is the cutoff, which is why a nightly schedule is what
 * decides when the day's orders lock.
 *
 * Two callers, distinguished only by the actor recorded in the log:
 *  - the nightly job, which passes no actor and is logged as `BOT-CONFIRM`
 *  - an operator hitting the manual trigger mid-day, logged under their own username
 *
 * Safe to call repeatedly — once a transaction leaves CREATED it stops matching.
 */
export const confirmAllCreated = (actor?: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const pending = yield* repo.listCreated();
        const by = actor ?? BOT_CONFIRM_ACTOR;
        const note = actor ? 'ยืนยันทั้งหมด (manual)' : 'ยืนยันอัตโนมัติรอบกลางคืน';

        for (const transaction of pending) {
            yield* applyStatus(transaction.id, 'CONFIRMED', note, by);
        }

        return { confirmed: pending.length, ids: pending.map((t) => t.id) };
    }).pipe(Effect.provide(wholeBuyLive))

// --- Queries ---

// The brand split comes off the movement ledger rather than a column, because that is where it
// was written — before STOCKED there is nothing to report, and after it the ledger and the
// balances are the same rows.
export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const [transaction, statuses, brandSplit] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
            findBrandSplitByReference(REFERENCE_TYPE, id),
        ]);
        return { transaction, statuses, brandSplit };
    }).pipe(Effect.provide(wholeBuyLive))

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(wholeBuyLive))
