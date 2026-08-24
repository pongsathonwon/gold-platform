import { Context, Data, Effect } from "effect";
import { RETAIL_SELL_TRANSITIONS } from "@gold-platform/types";
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
    updatedBy: string
}

// --- Valid transitions ---

/**
 * The shared map from `@gold-platform/types`, re-typed against the database enum. The annotation is
 * the point: if the two ever diverge — a status added to the enum, or one renamed in the shared map
 * — this stops compiling instead of the UI quietly offering a move the API refuses.
 *
 * `SHIPPED` is in the enum and leads nowhere. Restoring it means adding it here (via the shared map)
 * and restoring the inventory decrement the old code hung off it; nothing else.
 */
export const allowedTransitions: Record<RetailSellStatus, RetailSellStatus[]> = RETAIL_SELL_TRANSITIONS
