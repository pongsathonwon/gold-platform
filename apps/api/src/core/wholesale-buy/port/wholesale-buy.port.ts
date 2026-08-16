import { Context, Data, Effect } from "effect";
import {
    BrandSplit, WHOLE_BUY_INVENTORY_STATUS, WHOLE_BUY_RETURN_STATUS, WHOLE_BUY_TRANSITIONS,
} from "@gold-platform/types";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeBuyStatus, CreateWholeBuyTransaction,
    WholeBuyStatus, WholeBuyStatusShape, WholeBuyTransactionShape,
} from "../../../infrastructure/db/schema/wholesale-buy.schema.js";

// the DB enum is the source of truth for the reason set; the shared Zod enum in
// @gold-platform/types validates the wire format and the two are checked against each other below
export type ReturnReason = NonNullable<WholeBuyTransactionShape['returnReason']>

// --- Domain errors ---

export class TransactionNotFoundError extends Data.TaggedError("WholeBuyTransactionNotFoundError")<{
    id: string
}> {}

export class InvalidTransitionError extends Data.TaggedError("WholeBuyInvalidTransitionError")<{
    from: WholeBuyStatus
    to: WholeBuyStatus
}> {}

// every failure-branch transition must say why — the status log is the audit trail
export class NoteRequiredError extends Data.TaggedError("WholeBuyNoteRequiredError")<{
    status: WholeBuyStatus
}> {}

// edits are only accepted while the transaction is still CREATED — confirmation is the lock
export class NotEditableError extends Data.TaggedError("WholeBuyNotEditableError")<{
    id: string
    currentStatus: WholeBuyStatus
}> {}

// a shipment going back has to say which of the three checks it failed — the note alone cannot
// be aggregated, and supplier reliability is the whole reason the failure statuses are separate
export class ReturnReasonRequiredError extends Data.TaggedError("WholeBuyReturnReasonRequiredError")<{
    id: string
}> {}

// --- Repository port (outbound) ---

export type ListFilter = Partial<Pick<WholeBuyTransactionShape,
    'currentStatus' | 'settlementPeriod' | 'supplierId'>>

// transactionDate and settlementPeriod move together — the period is derived from the date, so
// neither is ever patched without the other
export type UpdateTransactionFields = Partial<Pick<WholeBuyTransactionShape,
    | 'supplierId' | 'purityId' | 'productTypeId'
    | 'weightGb' | 'weightGm' | 'conversionFactor'
    | 'pricePerGb965' | 'pricePerGb999' | 'totalAmount' | 'notes'
    | 'transactionDate' | 'settlementPeriod'>>

// the contested weight, written on a move into DISPUTED and cleared again on acceptance
export type ContestedFields = Pick<WholeBuyTransactionShape,
    'actualWeightGb' | 'actualWeightGm' | 'actualAmount'>

// the two figures a closing move records: what was actually paid, and why goods went back
export type SettlementFields = Partial<Pick<WholeBuyTransactionShape,
    'settledAmount' | 'returnReason'>>

export interface ForWholeBuyRepository {
    createTransaction(req: CreateWholeBuyTransaction): Effect.Effect<WholeBuyTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<WholeBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: ListFilter): Effect.Effect<WholeBuyTransactionShape[], RepositoryError>
    updateTransaction(id: string, fields: UpdateTransactionFields): Effect.Effect<WholeBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    updateCurrentStatus(id: string, status: WholeBuyStatus): Effect.Effect<void, RepositoryError>
    // records the weight we say the delivery came to; written on a move into DISPUTED
    recordContestedWeights(id: string, fields: ContestedFields): Effect.Effect<void, RepositoryError>
    // records the settled amount or the return reason as a closing move supplies them
    recordSettlement(id: string, fields: SettlementFields): Effect.Effect<void, RepositoryError>
    // everything still awaiting confirmation — the confirm-all job's work list
    listCreated(): Effect.Effect<WholeBuyTransactionShape[], RepositoryError>
    createStatus(req: CreateWholeBuyStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<WholeBuyStatusShape[], RepositoryError>
}

export class WholeBuyRepository extends Context.Tag('wholesale-buy/repository')<WholeBuyRepository, ForWholeBuyRepository>() {}

// --- Command shapes ---

// settlementPeriod is never caller-supplied — it is derived server-side from transactionDate.
// Brand is not supplied either: an order cannot know what stamp will turn up, so brand is
// recorded on the move into STOCKED against the pools the gold actually lands in.
export interface CreateTransactionReq {
    supplierId: string
    purityId: string
    productTypeId: string
    weight: number
    // the only price supplied; the 99.9% quote is derived from it
    pricePerGb965: number
    // `YYYY-MM-DD`, the day the order was placed. Optional: omitted means today, which is what a
    // shop working in real time sends. What it is *not* is the insert timestamp — that is
    // recordedAt, written from the server clock and never accepted from a caller.
    transactionDate?: string
    notes?: string
    recordedBy: string
}

export interface UpdateTransactionReq {
    transactionId: string
    supplierId?: string
    purityId?: string
    productTypeId?: string
    weight?: number
    pricePerGb965?: number
    // correcting it re-derives the settlement period; only accepted while still CREATED, like
    // every other field here
    transactionDate?: string
    notes?: string
    updatedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: WholeBuyStatus
    note?: string
    // only read on a move into DISPUTED — what we say the delivery weighed, in the ordered unit
    actualWeight?: number
    // only read on a move into PAID — what was actually paid, when it differed from totalAmount
    settledAmount?: number
    // required on a move into RETURNED
    returnReason?: ReturnReason
    // only read on a move into STOCKED — the named stamps the delivery carried. The fungible pool
    // takes the residual, so this divides the ordered weight and can never change it.
    brandSplit?: BrandSplit
    updatedBy: string
}

export interface ReceiveAndStockReq {
    transactionId: string
    note?: string
    brandSplit?: BrandSplit
    updatedBy: string
}

// --- State machine ---

// The map lives in @gold-platform/types so the web app offers exactly the moves this validates.
// The assignment is the check: if the two status unions ever diverge, this stops compiling.
export const allowedTransitions: Record<WholeBuyStatus, WholeBuyStatus[]> = WHOLE_BUY_TRANSITIONS

// transitions that must carry a note explaining the failure
export const NOTE_REQUIRED_STATUSES: WholeBuyStatus[] = [
    'PAYMENT_FAILED', 'DELIVERY_FAILED', 'DISPUTED',
    'CANCELLED', 'REJECTED', 'RETURNED', 'REFUNDED', 'WRITTEN_OFF',
]

// the only transition that moves inventory — gold enters stock when it has been accepted,
// not when it arrives
export const INVENTORY_STATUS: WholeBuyStatus = WHOLE_BUY_INVENTORY_STATUS

// the move that sends a shipment back, whether refused at the door or returned after a dispute
export const RETURN_STATUS: WholeBuyStatus = WHOLE_BUY_RETURN_STATUS

// the move that records what was actually paid
export const SETTLEMENT_STATUS: WholeBuyStatus = 'PAID'

// the move that records a weight we contest
export const CONTESTED_STATUS: WholeBuyStatus = 'DISPUTED'

// The hour the nightly confirm job runs. It is not a deadline the API enforces — the job is the
// cutoff — but knowing when the next run lands is what lets the UI tell an operator how long
// their order stays editable. Default midnight; override to match the actual cron schedule.
const DEFAULT_AUTO_CONFIRM_HOUR = 0

export function autoConfirmHour(): number {
    const raw = Number(process.env.WHOLESALE_BUY_AUTO_CONFIRM_HOUR)
    if (!Number.isInteger(raw) || raw < 0 || raw > 23) return DEFAULT_AUTO_CONFIRM_HOUR
    return raw
}

/** The next time the nightly job will run, at or after `from`. */
export function nextAutoConfirmAt(from: Date): Date {
    const next = new Date(from)
    next.setHours(autoConfirmHour(), 0, 0, 0)
    if (next <= from) next.setDate(next.getDate() + 1)
    return next
}

export const BOT_CONFIRM_ACTOR = 'BOT-CONFIRM'
