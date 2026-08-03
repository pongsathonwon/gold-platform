import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { derivePricePerGb999 } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, BOT_CONFIRM_ACTOR, CreateTransactionReq,
    INVENTORY_STATUS, InvalidTransitionError, ListFilter, MISMATCH_STATUS,
    nextAutoConfirmAt, NOTE_REQUIRED_STATUSES, NotEditableError, NoteRequiredError,
    ReceiveAndCheckReq, UpdateTransactionFields, UpdateTransactionReq, WholeBuyRepository,
} from "../port/wholesale-buy.port.js";
import { makeWholeBuyRepository } from "../adapter/wholesale-buy.repository.js";
import { WholeBuyStatus, WholeBuyTransactionShape } from "../../../infrastructure/db/schema/wholesale-buy.schema.js";
import { increment } from "../../inventory/application/inventory.usecase.js";
import { findQuantityRule, resolveMeasuredQuantity, resolveQuantity } from "../../../infrastructure/quantity.js";
import { resolveSettlementPeriod } from "../../../infrastructure/settlement.js";

const wholeBuyLive = Layer.effect(WholeBuyRepository, makeWholeBuyRepository);

// wholesale-buy always lands in the foreign pool — only smelting produces domestic stock
const ORIGIN = 'foreign' as const
const REFERENCE_TYPE = 'WHOLESALE_BUY'
// 99.9% pools are keyed by origin, not brand; 'NA' is the sentinel that keeps the key shape uniform
const NA_BRAND = 'NA'

// Which of the two recorded quotes applies. 99.9% gold (unitOfMeasure 'g') is priced off the
// 96.5% quote by the purity ratio — the operator enters both, the item's purity picks one.
const applicablePrice = (unitOfMeasure: 'g' | 'gb', pricePerGb965: number, pricePerGb999: number) =>
    unitOfMeasure === 'g' ? pricePerGb999 : pricePerGb965

const brandFor = (unitOfMeasure: 'g' | 'gb', brandId?: string) =>
    unitOfMeasure === 'g' ? NA_BRAND : (brandId ?? NA_BRAND)

// The stored weight expressed in the unit the operator types for this pairing. Comparing in the
// input unit rather than in GB is what makes the equality check stable: GB for a 99.9% order is a
// derived figure, and `conversionFactor` is snapshotted per transaction, so a master-rate change
// between order and delivery would make two identical kg figures compare unequal.
const orderedWeightIn = (inputUnit: 'kg' | 'gb', transaction: WholeBuyTransactionShape) =>
    inputUnit === 'kg' ? transaction.weightGm / 1000 : transaction.weightGb

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
            brandId: brandFor(unitOfMeasure, req.brandId),
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
            req.pricePerGb965 !== undefined || req.brandId !== undefined;

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
            fields.brandId = brandFor(unitOfMeasure, req.brandId ?? transaction.brandId);
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
 * Verifies a delivery against its order. Acceptance is **strictly all-or-nothing**: the delivered
 * weight must equal the ordered weight exactly. Anything else is a discrepancy for a human to
 * settle with the supplier, not something to book at a pro-rated cost.
 *
 * Returns the status the transaction actually reaches:
 *  - equal (or no weight supplied) → `CHECKED`, and the ordered weight enters inventory
 *  - anything else                 → `DISPUTED`, nothing enters inventory; the measured weight is
 *                                    still recorded so the discrepancy is on the record
 */
const checkDelivery = (
    transaction: WholeBuyTransactionShape,
    actualWeight: number | undefined,
    actor: string,
) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;

        if (actualWeight !== undefined) {
            const rule = yield* findQuantityRule(transaction.productTypeId, transaction.purityId);
            const ordered = orderedWeightIn(rule.inputUnit, transaction);

            if (actualWeight !== ordered) {
                // a measured weight, not an ordered one — the orderable-quantity rule must not
                // apply to it; a supplier can deliver 11.95 GB against a 12 GB order
                const measured = yield* resolveMeasuredQuantity(
                    transaction.productTypeId, transaction.purityId, actualWeight,
                );
                const price = applicablePrice(
                    measured.unitOfMeasure, transaction.pricePerGb965, transaction.pricePerGb999,
                );

                yield* repo.recordCheckedWeights(transaction.id, {
                    actualWeightGb: measured.weightGb,
                    actualWeightGm: measured.weightGm,
                    actualAmount: measured.weightGb * price,
                });

                return { status: MISMATCH_STATUS, ordered, actual: actualWeight, unit: rule.inputUnit };
            }
        }

        // Accepted: by definition the delivery equals the order, so there is no discrepancy to
        // carry. Clearing matters on a re-check — a shipment that was DISPUTED at 14 and then
        // accepted at 15 would otherwise keep showing the stale 14 as what arrived. The DISPUTED
        // entry in the status log is where that history belongs, and it stays there.
        if (transaction.actualWeightGb !== null) {
            yield* repo.recordCheckedWeights(transaction.id, {
                actualWeightGb: null, actualWeightGm: null, actualAmount: null,
            });
        }

        yield* increment({
            purityId: transaction.purityId,
            brandId: transaction.brandId,
            // wholesale-buy never produces domestic stock, whatever the purity — only smelting does
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            weightGb: transaction.weightGb,
            weightGm: transaction.weightGm,
            conversionFactor: transaction.conversionFactor,
            totalCost: transaction.totalAmount,
            referenceType: REFERENCE_TYPE,
            referenceId: transaction.id,
            createdBy: actor,
        });

        return { status: INVENTORY_STATUS, ordered: 0, actual: 0, unit: 'gb' as const };
    })

// the note written when a delivery is diverted to DISPUTED — the operator's own note still wins
// if they gave one, with the measured discrepancy appended so the log carries the numbers
const mismatchNote = (
    result: { ordered: number; actual: number; unit: 'kg' | 'gb' },
    note: string | undefined,
) => {
    const unit = result.unit === 'kg' ? 'kg' : 'บาท'
    const detail = `รับจริง ${result.actual} ${unit} ไม่ตรงกับที่สั่ง ${result.ordered} ${unit}`
    return note?.trim() ? `${note.trim()} — ${detail}` : detail
}

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

const assertTransitionAllowed = (from: WholeBuyStatus, to: WholeBuyStatus, note: string | undefined) =>
    Effect.gen(function* () {
        if (!allowedTransitions[from].includes(to)) {
            return yield* Effect.fail(new InvalidTransitionError({ from, to }));
        }
        // failure branches must record why — that reason is unrecoverable from anywhere else
        if (NOTE_REQUIRED_STATUSES.includes(to) && !note?.trim()) {
            return yield* Effect.fail(new NoteRequiredError({ status: to }));
        }
    })

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction.currentStatus, req.toStatus, req.note);

        if (req.toStatus !== INVENTORY_STATUS) {
            yield* applyStatus(transaction.id, req.toStatus, req.note, req.updatedBy);
            return { status: req.toStatus };
        }

        // a check that does not match the order lands on DISPUTED instead — the caller asked for
        // CHECKED, the goods decided otherwise
        const result = yield* checkDelivery(transaction, req.actualWeight, req.updatedBy);
        const diverted = result.status !== INVENTORY_STATUS;
        yield* applyStatus(
            transaction.id, result.status,
            diverted ? mismatchNote(result, req.note) : req.note,
            req.updatedBy,
        );
        return { status: result.status };
    }).pipe(Effect.provide(wholeBuyLive))

/**
 * Receive and check in one operator action — how the floor actually works today with a handful
 * of staff. Both status entries are still written, so splitting this into two endpoints later
 * changes nothing about the history that has already been recorded.
 */
export const receiveAndCheck = (req: ReceiveAndCheckReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction.currentStatus, 'RECEIVED', req.note);
        yield* assertTransitionAllowed('RECEIVED', 'CHECKED', req.note);

        yield* applyStatus(transaction.id, 'RECEIVED', req.note, req.updatedBy);

        // same all-or-nothing rule as a standalone check: a short or long delivery ends on
        // DISPUTED with nothing in inventory, not on CHECKED with a pro-rated cost
        const result = yield* checkDelivery(transaction, req.actualWeight, req.updatedBy);
        const diverted = result.status !== INVENTORY_STATUS;
        yield* applyStatus(
            transaction.id, result.status,
            diverted ? mismatchNote(result, req.note) : req.note,
            req.updatedBy,
        );
        return { status: result.status };
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

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(wholeBuyLive))

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(wholeBuyLive))
