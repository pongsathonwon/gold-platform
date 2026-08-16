import { Context, Data, Effect } from "effect";
import {
    BrandSplit, WHOLE_SELL_INVENTORY_STATUS, WHOLE_SELL_RETURN_STATUS,
    WHOLE_SELL_REVERSAL_STATUS, WHOLE_SELL_TRANSITIONS,
} from "@gold-platform/types";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeSellStatus, CreateWholeSellTransaction,
    WholeSellStatus, WholeSellStatusShape, WholeSellTransactionShape,
} from "../../../infrastructure/db/schema/wholesale-sell.schema.js";

export type ReturnReason = NonNullable<WholeSellTransactionShape['returnReason']>

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

// a shipment coming home has to say which check it failed, exactly as on the buy side — prose in
// a note cannot be counted, and "how often does this buyer send gold back" has to be answerable
export class ReturnReasonRequiredError extends Data.TaggedError("WholeSellReturnReasonRequiredError")<{
    id: string
}> {}

// --- Repository port (outbound) ---

export type ListFilter = Partial<Pick<WholeSellTransactionShape,
    'currentStatus' | 'settlementPeriod' | 'supplierId'>>

// transactionDate and settlementPeriod move together — the period is derived from the date, so
// neither is ever patched without the other
export type UpdateTransactionFields = Partial<Pick<WholeSellTransactionShape,
    | 'supplierId' | 'purityId' | 'productTypeId'
    | 'weightGb' | 'weightGm' | 'conversionFactor'
    | 'pricePerGb965' | 'pricePerGb999' | 'totalAmount' | 'notes'
    | 'transactionDate' | 'settlementPeriod'>>

// the buyer's own figure, written only when a shipped deal is disputed — never the packed weight,
// which always equals the agreement
export type ContestedFields = Pick<WholeSellTransactionShape,
    'actualWeightGb' | 'actualWeightGm' | 'actualAmount'>

// the two figures a closing move records: what the buyer actually settled, and why gold came back
export type SettlementFields = Partial<Pick<WholeSellTransactionShape,
    'settledAmount' | 'returnReason'>>

export interface ForWholeSellRepository {
    createTransaction(req: CreateWholeSellTransaction): Effect.Effect<WholeSellTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<WholeSellTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: ListFilter): Effect.Effect<WholeSellTransactionShape[], RepositoryError>
    updateTransaction(id: string, fields: UpdateTransactionFields): Effect.Effect<WholeSellTransactionShape, RepositoryError | TransactionNotFoundError>
    updateCurrentStatus(id: string, status: WholeSellStatus): Effect.Effect<void, RepositoryError>
    // records the weight the buyer contests; written on a move into DISPUTED
    recordContestedWeights(id: string, fields: ContestedFields): Effect.Effect<void, RepositoryError>
    // records the settled amount or the return reason as a closing move supplies them
    recordSettlement(id: string, fields: SettlementFields): Effect.Effect<void, RepositoryError>
    // everything still awaiting confirmation — the confirm-all job's work list
    listCreated(): Effect.Effect<WholeSellTransactionShape[], RepositoryError>
    createStatus(req: CreateWholeSellStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<WholeSellStatusShape[], RepositoryError>
}

export class WholeSellRepository extends Context.Tag('wholesale-sell/repository')<WholeSellRepository, ForWholeSellRepository>() {}

// --- Command shapes ---

// settlementPeriod is never caller-supplied — it is derived server-side from transactionDate.
// Brand is not supplied either: which stamps leave the vault is decided at packing time, out of
// whatever is on the shelf, so brand is recorded on the move into PACKED.
export interface CreateTransactionReq {
    supplierId: string
    purityId: string
    productTypeId: string
    weight: number
    // the only price supplied; the 99.9% quote is derived from it
    pricePerGb965: number
    // `YYYY-MM-DD`, the day the deal was struck. Omitted means today. Distinct from recordedAt,
    // which is the insert timestamp and is never accepted from a caller.
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
    // correcting it re-derives the settlement period; only accepted while still CREATED
    transactionDate?: string
    notes?: string
    updatedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: WholeSellStatus
    note?: string
    // only read on a move into DISPUTED — the weight the buyer says their scale read
    actualWeight?: number
    // only read on a move into PAID — what was actually settled, when it differed from totalAmount
    settledAmount?: number
    // required on a move into RETURNED
    returnReason?: ReturnReason
    // only read on a move into PACKED — which pools the shipment is drawn from. The fungible pool
    // takes the residual, so this divides the agreed weight and can never change it.
    brandSplit?: BrandSplit
    updatedBy: string
}

// --- State machine ---

// The map lives in @gold-platform/types so the web app offers exactly the moves this validates.
// The assignment is the check: if the two status unions ever diverge, this stops compiling.
export const allowedTransitions: Record<WholeSellStatus, WholeSellStatus[]> = WHOLE_SELL_TRANSITIONS

// transitions that must carry a note explaining the failure
export const NOTE_REQUIRED_STATUSES: WholeSellStatus[] =
    ['DISPUTED', 'PAYMENT_FAILED', 'CANCELLED', 'REJECTED', 'RETURNED', 'WRITTEN_OFF']

// the move that sends gold back to us; it must say why
export const RETURN_STATUS: WholeSellStatus = WHOLE_SELL_RETURN_STATUS

// the move that records what the buyer actually settled
export const SETTLEMENT_STATUS: WholeSellStatus = 'PAID'

// the move that records the buyer's contested weight
export const CONTESTED_STATUS: WholeSellStatus = 'DISPUTED'

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
