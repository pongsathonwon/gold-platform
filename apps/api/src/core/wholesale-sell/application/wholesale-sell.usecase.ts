import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { derivePricePerGb999 } from "@gold-platform/types";
import {
    AdvanceStatusReq, allowedTransitions, BOT_CONFIRM_ACTOR, CreateTransactionReq,
    INVENTORY_STATUS, InvalidTransitionError, ListFilter, nextAutoConfirmAt,
    NOTE_REQUIRED_STATUSES, NotEditableError, NoteRequiredError, PackAndShipReq,
    REVERSAL_STATUS, REVERSE_REFERENCE_TYPE, UpdateTransactionFields, UpdateTransactionReq,
    WeightMismatchError, WholeSellRepository,
} from "../port/wholesale-sell.port.js";
import { makeWholeSellRepository } from "../adapter/wholesale-sell.repository.js";
import { WholeSellStatus, WholeSellTransactionShape } from "../../../infrastructure/db/schema/wholesale-sell.schema.js";
import { decrement, reverseDecrement } from "../../inventory/application/inventory.usecase.js";
import { findQuantityRule, resolveMeasuredQuantity, resolveQuantity } from "../../../infrastructure/quantity.js";
import { resolveSettlementPeriod } from "../../../infrastructure/settlement.js";

const wholeSellLive = Layer.effect(WholeSellRepository, makeWholeSellRepository);

// a wholesale sale always draws from the foreign pool — the domestic pool is smelted stock and
// only convert_out may consume it
const ORIGIN = 'foreign' as const
const REFERENCE_TYPE = 'WHOLESALE_SELL'
// 99.9% pools are keyed by origin, not brand; 'NA' is the sentinel that keeps the key shape uniform
const NA_BRAND = 'NA'

// Which of the two recorded quotes applies. 99.9% gold (unitOfMeasure 'g') is priced off the
// 96.5% quote by the purity ratio — the operator enters one, the item's purity picks which.
const applicablePrice = (unitOfMeasure: 'g' | 'gb', pricePerGb965: number, pricePerGb999: number) =>
    unitOfMeasure === 'g' ? pricePerGb999 : pricePerGb965

const brandFor = (unitOfMeasure: 'g' | 'gb', brandId?: string) =>
    unitOfMeasure === 'g' ? NA_BRAND : (brandId ?? NA_BRAND)

// The stored weight expressed in the unit the operator types for this pairing. Comparing in the
// input unit rather than in GB is what makes the equality check stable: GB for a 99.9% deal is a
// derived figure, and `conversionFactor` is snapshotted per transaction, so a master-rate change
// between agreement and handover would make two identical kg figures compare unequal.
const agreedWeightIn = (inputUnit: 'kg' | 'gb', transaction: WholeSellTransactionShape) =>
    inputUnit === 'kg' ? transaction.weightGm / 1000 : transaction.weightGb

// --- Commands ---

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const id = randomUUID();
        const now = new Date();

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
    }).pipe(Effect.provide(wholeSellLive))

/**
 * Pulls the gold out of the vault and out of the books.
 *
 * The packed weight must equal the agreed weight. Unlike the buy side, a mismatch is **not** a
 * status: the gold is still ours and we control what goes in the box, so a wrong weight is an
 * operator correction — re-pack and call again — not a durable state for someone to work. It
 * fails `WeightMismatchError` with nothing written and nothing decremented, and the transaction
 * stays CONFIRMED.
 *
 * A pool short of stock fails `InsufficientStockError` the same way, for the same reason.
 */
const packGoods = (
    transaction: WholeSellTransactionShape,
    actualWeight: number | undefined,
    actor: string,
) =>
    Effect.gen(function* () {
        if (actualWeight !== undefined) {
            const rule = yield* findQuantityRule(transaction.productTypeId, transaction.purityId);
            const agreed = agreedWeightIn(rule.inputUnit, transaction);

            if (actualWeight !== agreed) {
                return yield* Effect.fail(new WeightMismatchError({
                    id: transaction.id, agreed, packed: actualWeight, unit: rule.inputUnit,
                }));
            }
        }

        // cost comes off the pool's live WAC inside the locked transaction — totalAmount is the
        // sale price, which is revenue, not the cost basis being removed
        yield* decrement({
            purityId: transaction.purityId,
            brandId: transaction.brandId,
            // a sale never touches the domestic pool, whatever the purity — only convert_out may
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            weightGb: transaction.weightGb,
            weightGm: transaction.weightGm,
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
            actualAmount: measured.weightGb * price,
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

const assertTransitionAllowed = (from: WholeSellStatus, to: WholeSellStatus, note: string | undefined) =>
    Effect.gen(function* () {
        if (!allowedTransitions[from].includes(to)) {
            return yield* Effect.fail(new InvalidTransitionError({ from, to }));
        }
        // failure branches must record why — that reason is unrecoverable from anywhere else
        if (NOTE_REQUIRED_STATUSES.includes(to) && !note?.trim()) {
            return yield* Effect.fail(new NoteRequiredError({ status: to }));
        }
    })

/**
 * Runs the inventory side-effect a transition owns, if any. Exactly two transitions move stock:
 * PACKED takes it out, RETURNED puts it back. Both run before the status row is written, so a
 * failed movement leaves the transaction where it was rather than recording a move that never
 * physically happened.
 */
const applyInventoryEffect = (
    transaction: WholeSellTransactionShape,
    toStatus: WholeSellStatus,
    actualWeight: number | undefined,
    actor: string,
) =>
    Effect.gen(function* () {
        if (toStatus === INVENTORY_STATUS) {
            yield* packGoods(transaction, actualWeight, actor);
            return;
        }
        // only a shipment that actually left needs putting back — a deal that dies before PACKED
        // never had its stock removed. RETURNED is unreachable from those states anyway; this
        // guard is what keeps that true if the transition map is ever widened.
        if (toStatus === REVERSAL_STATUS) {
            yield* returnGoods(transaction, actor);
            return;
        }
        // no stock moves, but the buyer's figure goes on the record
        if (toStatus === 'DISPUTED') {
            yield* recordContestedWeight(transaction, actualWeight);
        }
    })

export const advanceStatus = (req: AdvanceStatusReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction.currentStatus, req.toStatus, req.note);
        yield* applyInventoryEffect(transaction, req.toStatus, req.actualWeight, req.updatedBy);
        yield* applyStatus(transaction.id, req.toStatus, req.note, req.updatedBy);

        return { status: req.toStatus };
    }).pipe(Effect.provide(wholeSellLive))

/**
 * Pack and ship in one operator action — the mirror of the buy side's receive-check, and one
 * action on the floor today for the same reason: the people who pull the gold are the people who
 * hand it to the courier. Both status entries are still written, so splitting this into two
 * endpoints later changes nothing about the history already recorded.
 */
export const packAndShip = (req: PackAndShipReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        yield* assertTransitionAllowed(transaction.currentStatus, 'PACKED', req.note);
        yield* assertTransitionAllowed('PACKED', 'SHIPPED', req.note);

        // the decrement runs once, on the way through PACKED — a mismatch or a short pool fails
        // here with neither status row written
        yield* packGoods(transaction, req.actualWeight, req.updatedBy);

        yield* applyStatus(transaction.id, 'PACKED', req.note, req.updatedBy);
        yield* applyStatus(transaction.id, 'SHIPPED', req.note, req.updatedBy);

        return { status: 'SHIPPED' as const };
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

export const getTransaction = (id: string) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        const [transaction, statuses] = yield* Effect.all([
            repo.findTransactionById(id),
            repo.listStatuses(id),
        ]);
        return { transaction, statuses };
    }).pipe(Effect.provide(wholeSellLive))

export const listTransactions = (req: ListFilter) =>
    Effect.gen(function* () {
        const repo = yield* WholeSellRepository;
        return yield* repo.listTransactions(req);
    }).pipe(Effect.provide(wholeSellLive))
