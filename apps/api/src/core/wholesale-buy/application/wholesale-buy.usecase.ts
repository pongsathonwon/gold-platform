import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import {
    AdvanceStatusReq, allowedTransitions, BOT_CONFIRM_ACTOR, CreateTransactionReq,
    editWindowHours, EditWindowExpiredError, INVENTORY_STATUS, InvalidTransitionError,
    ListFilter, NOTE_REQUIRED_STATUSES, NoteRequiredError, ReceiveAndCheckReq,
    UpdateTransactionFields, UpdateTransactionReq, WholeBuyRepository,
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

const addHours = (from: Date, hours: number) => new Date(from.getTime() + hours * 60 * 60 * 1000)

// --- Commands ---

export const createTransaction = (req: CreateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const id = randomUUID();
        const now = new Date();

        // validates the productType/purity pairing and the orderable-quantity rule for it
        const { weightGb, weightGm, conversionFactor, unitOfMeasure } =
            yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);

        const price = applicablePrice(unitOfMeasure, req.pricePerGb965, req.pricePerGb999);

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
            pricePerGb999: req.pricePerGb999,
            totalAmount: weightGb * price,
            actualWeightGb: null,
            actualWeightGm: null,
            actualAmount: null,
            // callers never supply the period — it is derived from the recording time and frozen
            settlementPeriod: resolveSettlementPeriod(now),
            currentStatus: 'CREATED',
            confirmDueAt: addHours(now, editWindowHours()),
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
 * Edits are accepted only while the transaction is still CREATED and inside its edit window.
 * Once the window closes the auto-confirm job takes the transaction to CONFIRMED, which is the
 * point the order is treated as committed to the supplier.
 */
export const updateTransaction = (req: UpdateTransactionReq) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const transaction = yield* repo.findTransactionById(req.transactionId);

        if (transaction.currentStatus !== 'CREATED' || new Date() >= transaction.confirmDueAt) {
            return yield* Effect.fail(new EditWindowExpiredError({
                id: transaction.id,
                currentStatus: transaction.currentStatus,
                confirmDueAt: transaction.confirmDueAt,
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
        const pricePerGb999 = req.pricePerGb999 ?? transaction.pricePerGb999;
        const pricingChanged =
            req.weight !== undefined || req.purityId !== undefined || req.productTypeId !== undefined ||
            req.pricePerGb965 !== undefined || req.pricePerGb999 !== undefined || req.brandId !== undefined;

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
 * Moves gold into inventory. Runs exactly once per transaction, on the move to CHECKED — stock
 * enters when it has been verified, not when it arrived. When the delivery came up short or long,
 * `actualWeight` is what enters inventory and what the cost is pro-rated against; the ordered
 * figures on the transaction are left untouched so the variance stays visible.
 */
const checkIntoInventory = (
    transaction: WholeBuyTransactionShape,
    actualWeight: number | undefined,
    actor: string,
) =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;

        let weightGb = transaction.weightGb;
        let weightGm = transaction.weightGm;
        let totalCost = transaction.totalAmount;

        if (actualWeight !== undefined) {
            // a measured weight, not an ordered one — the orderable-quantity rule must not apply
            const measured = yield* resolveMeasuredQuantity(
                transaction.productTypeId, transaction.purityId, actualWeight,
            );
            const price = applicablePrice(
                measured.unitOfMeasure, transaction.pricePerGb965, transaction.pricePerGb999,
            );
            weightGb = measured.weightGb;
            weightGm = measured.weightGm;
            totalCost = measured.weightGb * price;

            yield* repo.recordCheckedWeights(transaction.id, {
                actualWeightGb: weightGb,
                actualWeightGm: weightGm,
                actualAmount: totalCost,
            });
        }

        yield* increment({
            purityId: transaction.purityId,
            brandId: transaction.brandId,
            origin: ORIGIN,
            productTypeId: transaction.productTypeId,
            weightGb,
            weightGm,
            conversionFactor: transaction.conversionFactor,
            totalCost,
            referenceType: REFERENCE_TYPE,
            referenceId: transaction.id,
            createdBy: actor,
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

        if (req.toStatus === INVENTORY_STATUS) {
            yield* checkIntoInventory(transaction, req.actualWeight, req.updatedBy);
        }

        yield* applyStatus(transaction.id, req.toStatus, req.note, req.updatedBy);
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
        yield* checkIntoInventory(transaction, req.actualWeight, req.updatedBy);
        yield* applyStatus(transaction.id, 'CHECKED', req.note, req.updatedBy);
    }).pipe(Effect.provide(wholeBuyLive))

/**
 * Auto-confirm job. Everything still CREATED past its confirmDueAt moves to CONFIRMED under the
 * BOT-CONFIRM actor — the edit window has closed, so the order counts as committed. Safe to call
 * repeatedly: once a transaction leaves CREATED it stops matching.
 */
export const autoConfirmOverdue = () =>
    Effect.gen(function* () {
        const repo = yield* WholeBuyRepository;
        const overdue = yield* repo.listOverdueCreated(new Date());

        for (const transaction of overdue) {
            yield* applyStatus(
                transaction.id, 'CONFIRMED',
                `auto-confirmed after the ${editWindowHours()}h edit window`,
                BOT_CONFIRM_ACTOR,
            );
        }

        return { confirmed: overdue.length, ids: overdue.map((t) => t.id) };
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
