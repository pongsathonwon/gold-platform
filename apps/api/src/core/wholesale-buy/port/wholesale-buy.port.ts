import { Context, Data, Effect } from "effect";
import { WHOLE_BUY_INVENTORY_STATUS, WHOLE_BUY_TRANSITIONS } from "@gold-platform/types";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeBuyStatus, CreateWholeBuyTransaction,
    WholeBuyStatus, WholeBuyStatusShape, WholeBuyTransactionShape,
} from "../../../infrastructure/db/schema/wholesale-buy.schema.js";

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

// the delivery must match the order exactly to be accepted into stock
export class WeightMismatchError extends Data.TaggedError("WholeBuyWeightMismatchError")<{
    id: string
    ordered: number
    actual: number
    unit: 'kg' | 'gb'
}> {}

// --- Repository port (outbound) ---

export type ListFilter = Partial<Pick<WholeBuyTransactionShape,
    'currentStatus' | 'settlementPeriod' | 'supplierId'>>

export type UpdateTransactionFields = Partial<Pick<WholeBuyTransactionShape,
    | 'supplierId' | 'purityId' | 'brandId' | 'productTypeId'
    | 'weightGb' | 'weightGm' | 'conversionFactor'
    | 'pricePerGb965' | 'pricePerGb999' | 'totalAmount' | 'notes'>>

export type CheckedFields = Pick<WholeBuyTransactionShape,
    'actualWeightGb' | 'actualWeightGm' | 'actualAmount'>

export interface ForWholeBuyRepository {
    createTransaction(req: CreateWholeBuyTransaction): Effect.Effect<WholeBuyTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<WholeBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: ListFilter): Effect.Effect<WholeBuyTransactionShape[], RepositoryError>
    updateTransaction(id: string, fields: UpdateTransactionFields): Effect.Effect<WholeBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    updateCurrentStatus(id: string, status: WholeBuyStatus): Effect.Effect<void, RepositoryError>
    // records what physically arrived; written once, when the shipment is checked
    recordCheckedWeights(id: string, fields: CheckedFields): Effect.Effect<void, RepositoryError>
    // everything still awaiting confirmation — the confirm-all job's work list
    listCreated(): Effect.Effect<WholeBuyTransactionShape[], RepositoryError>
    createStatus(req: CreateWholeBuyStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<WholeBuyStatusShape[], RepositoryError>
}

export class WholeBuyRepository extends Context.Tag('wholesale-buy/repository')<WholeBuyRepository, ForWholeBuyRepository>() {}

// --- Command shapes ---

// settlementPeriod is never caller-supplied — it is derived from recordedAt server-side
export interface CreateTransactionReq {
    supplierId: string
    purityId: string
    // absent for 99.9% — the server substitutes the 'NA' sentinel so the inventory pool key matches
    brandId?: string
    productTypeId: string
    weight: number
    // the only price supplied; the 99.9% quote is derived from it
    pricePerGb965: number
    notes?: string
    recordedBy: string
}

export interface UpdateTransactionReq {
    transactionId: string
    supplierId?: string
    purityId?: string
    brandId?: string
    productTypeId?: string
    weight?: number
    pricePerGb965?: number
    notes?: string
    updatedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: WholeBuyStatus
    note?: string
    // only read on a transition into CHECKED — what physically arrived, in the ordered weight's unit
    actualWeight?: number
    updatedBy: string
}

export interface ReceiveAndCheckReq {
    transactionId: string
    // what physically arrived, in the same unit as the ordered weight; omit when it matched
    actualWeight?: number
    note?: string
    updatedBy: string
}

// --- State machine ---

// The map lives in @gold-platform/types so the web app offers exactly the moves this validates.
// The assignment is the check: if the two status unions ever diverge, this stops compiling.
export const allowedTransitions: Record<WholeBuyStatus, WholeBuyStatus[]> = WHOLE_BUY_TRANSITIONS

// transitions that must carry a note explaining the failure
export const NOTE_REQUIRED_STATUSES: WholeBuyStatus[] =
    ['PAYMENT_FAILED', 'DELIVERY_FAILED', 'DISPUTED', 'CANCELLED', 'REJECTED', 'RETURNED', 'WRITTEN_OFF']

// the only transition that moves inventory — gold enters stock when it has been verified,
// not when it arrives
export const INVENTORY_STATUS: WholeBuyStatus = WHOLE_BUY_INVENTORY_STATUS

// where a delivery goes when it does not match the order
export const MISMATCH_STATUS: WholeBuyStatus = 'DISPUTED'

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
