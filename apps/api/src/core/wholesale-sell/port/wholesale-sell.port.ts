import { Context, Data, Effect } from "effect";
import {
    WHOLE_SELL_INVENTORY_STATUS, WHOLE_SELL_REVERSAL_STATUS, WHOLE_SELL_TRANSITIONS,
} from "@gold-platform/types";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeSellStatus, CreateWholeSellTransaction,
    WholeSellStatus, WholeSellStatusShape, WholeSellTransactionShape,
} from "../../../infrastructure/db/schema/wholesale-sell.schema.js";

// --- Domain errors ---

export class TransactionNotFoundError extends Data.TaggedError("WholeSellTransactionNotFoundError")<{
    id: string
}> {}

export class InvalidTransitionError extends Data.TaggedError("WholeSellInvalidTransitionError")<{
    from: WholeSellStatus
    to: WholeSellStatus
}> {}

// every failure-branch transition must say why — the status log is the audit trail
export class NoteRequiredError extends Data.TaggedError("WholeSellNoteRequiredError")<{
    status: WholeSellStatus
}> {}

// edits are only accepted while the transaction is still CREATED — confirmation is the lock
export class NotEditableError extends Data.TaggedError("WholeSellNotEditableError")<{
    id: string
    currentStatus: WholeSellStatus
}> {}

/**
 * The packed weight did not equal the agreed weight.
 *
 * This is an error rather than a status, unlike the buy side's DISPUTED. The gold is still in
 * our own vault at this point and we control what goes in the box, so a wrong weight is an
 * operator correction — re-pack and call again — not a durable business state anyone has to
 * work. The transaction stays CONFIRMED and nothing is decremented.
 */
export class WeightMismatchError extends Data.TaggedError("WholeSellWeightMismatchError")<{
    id: string
    agreed: number
    packed: number
    unit: 'kg' | 'gb'
}> {}

// --- Repository port (outbound) ---

export type ListFilter = Partial<Pick<WholeSellTransactionShape,
    'currentStatus' | 'settlementPeriod' | 'supplierId'>>

export type UpdateTransactionFields = Partial<Pick<WholeSellTransactionShape,
    | 'supplierId' | 'purityId' | 'brandId' | 'productTypeId'
    | 'weightGb' | 'weightGm' | 'conversionFactor'
    | 'pricePerGb965' | 'pricePerGb999' | 'totalAmount' | 'notes'>>

// the buyer's own figure, written only when a shipped deal is disputed — never the packed weight,
// which always equals the agreement
export type ContestedFields = Pick<WholeSellTransactionShape,
    'actualWeightGb' | 'actualWeightGm' | 'actualAmount'>

export interface ForWholeSellRepository {
    createTransaction(req: CreateWholeSellTransaction): Effect.Effect<WholeSellTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<WholeSellTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: ListFilter): Effect.Effect<WholeSellTransactionShape[], RepositoryError>
    updateTransaction(id: string, fields: UpdateTransactionFields): Effect.Effect<WholeSellTransactionShape, RepositoryError | TransactionNotFoundError>
    updateCurrentStatus(id: string, status: WholeSellStatus): Effect.Effect<void, RepositoryError>
    // records the weight the buyer contests; written on a move into DISPUTED
    recordContestedWeights(id: string, fields: ContestedFields): Effect.Effect<void, RepositoryError>
    // everything still awaiting confirmation — the confirm-all job's work list
    listCreated(): Effect.Effect<WholeSellTransactionShape[], RepositoryError>
    createStatus(req: CreateWholeSellStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<WholeSellStatusShape[], RepositoryError>
}

export class WholeSellRepository extends Context.Tag('wholesale-sell/repository')<WholeSellRepository, ForWholeSellRepository>() {}

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
    toStatus: WholeSellStatus
    note?: string
    // only read on a transition into PACKED — what came out of the vault, in the agreed unit
    actualWeight?: number
    updatedBy: string
}

export interface PackAndShipReq {
    transactionId: string
    // what came out of the vault, in the same unit as the agreed weight; omit when it matches
    actualWeight?: number
    note?: string
    updatedBy: string
}

// --- State machine ---

// The map lives in @gold-platform/types so the web app offers exactly the moves this validates.
// The assignment is the check: if the two status unions ever diverge, this stops compiling.
export const allowedTransitions: Record<WholeSellStatus, WholeSellStatus[]> = WHOLE_SELL_TRANSITIONS

// transitions that must carry a note explaining the failure
export const NOTE_REQUIRED_STATUSES: WholeSellStatus[] =
    ['DISPUTED', 'PAYMENT_FAILED', 'CANCELLED', 'REJECTED', 'RETURNED', 'WRITTEN_OFF']

// the transition that takes gold out of stock — it stops being ours when it leaves the vault to
// be packed, not when it ships and not when the money lands
export const INVENTORY_STATUS: WholeSellStatus = WHOLE_SELL_INVENTORY_STATUS

// the transition that puts it back. Every state reachable after the decrement in which the gold
// can still physically come home routes here, and entering it reverses the movement.
export const REVERSAL_STATUS: WholeSellStatus = WHOLE_SELL_REVERSAL_STATUS

// the movement ledger's reference type for a reversal, so a returned shipment reads as its own
// event beside the original decrement rather than silently cancelling it out
export const REVERSE_REFERENCE_TYPE = 'WHOLESALE_SELL_RETURN'

// The hour the nightly confirm job runs. It is not a deadline the API enforces — the job is the
// cutoff — but knowing when the next run lands is what lets the UI tell an operator how long
// their deal stays editable. Default midnight; override to match the actual cron schedule.
const DEFAULT_AUTO_CONFIRM_HOUR = 0

export function autoConfirmHour(): number {
    const raw = Number(process.env.WHOLESALE_SELL_AUTO_CONFIRM_HOUR)
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
