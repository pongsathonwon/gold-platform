import { Context, Data, Effect } from "effect";
import { BrandSplit, RETAIL_SELL_INVENTORY_STATUS, RETAIL_SELL_TRANSITIONS } from "@gold-platform/types";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateRetailSellStatus, CreateRetailSellTransaction,
    RetailSellStatus, RetailSellStatusShape, RetailSellTransactionShape,
} from "../../../infrastructure/db/schema/retail-sell.schema.js";

// --- Domain errors ---

export class TransactionNotFoundError extends Data.TaggedError("RetailSellTransactionNotFoundError")<{
    id: string
}> {}

export class InvalidTransitionError extends Data.TaggedError("RetailSellInvalidTransitionError")<{
    from: RetailSellStatus
    to: RetailSellStatus
}> {}

export class NoteRequiredError extends Data.TaggedError("RetailSellNoteRequiredError")<{
    status: RetailSellStatus
}> {}

// --- Repository port (outbound) ---

export type ListFilter =
    Partial<Pick<RetailSellTransactionShape, 'currentStatus' | 'settlementPeriod' | 'branchCode'>>
    & { from?: string; to?: string }

export interface ForRetailSellRepository {
    createTransaction(req: CreateRetailSellTransaction): Effect.Effect<RetailSellTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<RetailSellTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: ListFilter): Effect.Effect<RetailSellTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: RetailSellStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateRetailSellStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<RetailSellStatusShape[], RepositoryError>
}

export class RetailSellRepository extends Context.Tag('retail-sell/repository')<RetailSellRepository, ForRetailSellRepository>() {}

// --- Command shapes ---

export interface CreateTransactionReq {
    branchCode: string
    purityId: string
    productTypeId: string
    weight: number
    pricePerGb: number
    operationFee?: number
    transactionDate?: string
    notes?: string
    recordedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: RetailSellStatus
    note?: string
    // read only on the move into PACKED: which pools the gold is drawn out of. Omitted, the whole
    // weight comes out of the fungible pool; on 99.9% anything sent is refused.
    brandSplit?: BrandSplit
    updatedBy: string
}

// The one status that moves stock, shared with the UI so the split fields appear on the same move
// the server reads them on. `satisfies` against the DB enum keeps the two from drifting.
export const INVENTORY_STATUS = RETAIL_SELL_INVENTORY_STATUS satisfies RetailSellStatus
// what the movement ledger files these under — the same value the manual loss form offers for an
// after-the-fact correction, so a retail sale's stock reads as one thing on the movements page
export const REFERENCE_TYPE = 'RETAIL_SELL'

// --- Valid transitions ---

/**
 * The shared map from `@gold-platform/types`, re-typed against the database enum. The annotation is
 * the point: if the two ever diverge — a status added to the enum, or one renamed in the shared map
 * — this stops compiling instead of the UI quietly offering a move the API refuses.
 *
 * `PACKED` is where the decrement fires and, for now, where a sale stops. `SHIPPED` is in the enum
 * and leads nowhere; it follows `PACKED` once hand-over is built, and moves no stock when it does —
 * the gold already left at `PACKED`.
 */
export const allowedTransitions: Record<RetailSellStatus, RetailSellStatus[]> = RETAIL_SELL_TRANSITIONS
