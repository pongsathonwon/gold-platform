import { Context, Data, Effect } from "effect";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeSellStatus, CreateWholeSellTransaction,
    WholeSellStatus, WholeSellStatusShape, WholeSellTransactionShape,
} from "../../../infrastructure/db/schema/wholesale-sell.schema.js";

// --- Domain errors ---

export class TransactionNotFoundError extends Data.TaggedError("TransactionNotFoundError")<{
    id: string
}> {}

export class InvalidTransitionError extends Data.TaggedError("InvalidTransitionError")<{
    from: WholeSellStatus
    to: WholeSellStatus
}> {}

// --- Repository port (outbound) ---

export interface ForWholeSellRepository {
    createTransaction(req: CreateWholeSellTransaction): Effect.Effect<WholeSellTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<WholeSellTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: Partial<Pick<WholeSellTransactionShape, 'currentStatus' | 'settlementPeriod'>>): Effect.Effect<WholeSellTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: WholeSellStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateWholeSellStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<WholeSellStatusShape[], RepositoryError>
}

export class WholeSellRepository extends Context.Tag('wholesale-sell/repository')<WholeSellRepository, ForWholeSellRepository>() {}

// --- Command shapes ---

export interface CreateTransactionReq {
    supplierId: string
    purityId: string
    brandId: string
    productTypeId: string
    weight: number
    pricePerGb: number
    settlementPeriod: string
    recordedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: WholeSellStatus
    note?: string
    updatedBy: string
}

// --- Valid transitions ---

export const allowedTransitions: Record<WholeSellStatus, WholeSellStatus[]> = {
    DRAFT:     ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['SHIPPED',   'CANCELLED'],
    SHIPPED:   ['SETTLED'],
    SETTLED:   [],
    CANCELLED: [],
}
