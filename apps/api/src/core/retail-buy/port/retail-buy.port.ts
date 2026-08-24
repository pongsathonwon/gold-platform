import { Context, Data, Effect } from "effect";
import { RETAIL_BUY_TRANSITIONS } from "@gold-platform/types";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateRetailBuyStatus, CreateRetailBuyTransaction,
    RetailBuyStatus, RetailBuyStatusShape, RetailBuyTransactionShape,
} from "../../../infrastructure/db/schema/retail-buy.schema.js";

// --- Domain errors ---

export class TransactionNotFoundError extends Data.TaggedError("RetailBuyTransactionNotFoundError")<{
    id: string
}> {}

export class InvalidTransitionError extends Data.TaggedError("RetailBuyInvalidTransitionError")<{
    from: RetailBuyStatus
    to: RetailBuyStatus
}> {}

export class NoteRequiredError extends Data.TaggedError("RetailBuyNoteRequiredError")<{
    status: RetailBuyStatus
}> {}

// --- Repository port (outbound) ---

export type ListFilter =
    Partial<Pick<RetailBuyTransactionShape, 'currentStatus' | 'settlementPeriod' | 'branchCode'>>
    & { from?: string; to?: string }

export interface ForRetailBuyRepository {
    createTransaction(req: CreateRetailBuyTransaction): Effect.Effect<RetailBuyTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<RetailBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: ListFilter): Effect.Effect<RetailBuyTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: RetailBuyStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateRetailBuyStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<RetailBuyStatusShape[], RepositoryError>
}

export class RetailBuyRepository extends Context.Tag('retail-buy/repository')<RetailBuyRepository, ForRetailBuyRepository>() {}

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
    toStatus: RetailBuyStatus
    note?: string
    updatedBy: string
}

// --- Valid transitions ---

/**
 * The shared map from `@gold-platform/types`, re-typed against the database enum. The annotation is
 * the point: if the two ever diverge — a status added to the enum, or one renamed in the shared map
 * — this stops compiling instead of the UI quietly offering a move the API refuses.
 */
export const allowedTransitions: Record<RetailBuyStatus, RetailBuyStatus[]> = RETAIL_BUY_TRANSITIONS
