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

// edits are only accepted while CREATED and before confirmDueAt
export class EditWindowExpiredError extends Data.TaggedError("WholeBuyEditWindowExpiredError")<{
    id: string
    currentStatus: WholeBuyStatus
    confirmDueAt: Date
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
    // records what physically arrived; written once, as part of the move to CHECKED
    recordCheckedWeights(id: string, fields: CheckedFields): Effect.Effect<void, RepositoryError>
    // CREATED transactions whose confirmDueAt has passed — the auto-confirm job's work list
    listOverdueCreated(now: Date): Effect.Effect<WholeBuyTransactionShape[], RepositoryError>
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
    pricePerGb965: number
    pricePerGb999: number
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
    pricePerGb999?: number
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
    ['PAYMENT_FAILED', 'DISPUTED', 'CANCELLED', 'REJECTED', 'RETURNED']

// the only transition that moves inventory — gold enters stock when it has been verified,
// not when it arrives
export const INVENTORY_STATUS: WholeBuyStatus = WHOLE_BUY_INVENTORY_STATUS

// How long a CREATED transaction stays editable before the auto-confirm job takes it.
// Configurable per operating conditions; clamped to the 1–12 hour band the business runs on.
const DEFAULT_EDIT_WINDOW_HOURS = 6
const MIN_EDIT_WINDOW_HOURS = 1
const MAX_EDIT_WINDOW_HOURS = 12

export function editWindowHours(): number {
    const raw = Number(process.env.WHOLESALE_BUY_EDIT_WINDOW_HOURS)
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EDIT_WINDOW_HOURS
    return Math.min(Math.max(raw, MIN_EDIT_WINDOW_HOURS), MAX_EDIT_WINDOW_HOURS)
}

export const BOT_CONFIRM_ACTOR = 'BOT-CONFIRM'
