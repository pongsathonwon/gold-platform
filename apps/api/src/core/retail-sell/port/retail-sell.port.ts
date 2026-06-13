import { Context, Data, Effect } from "effect";
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

// --- Repository port (outbound) ---

export interface ForRetailSellRepository {
    createTransaction(req: CreateRetailSellTransaction): Effect.Effect<RetailSellTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<RetailSellTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: Partial<Pick<RetailSellTransactionShape, 'currentStatus' | 'settlementPeriod'>>): Effect.Effect<RetailSellTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: RetailSellStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateRetailSellStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<RetailSellStatusShape[], RepositoryError>
}

export class RetailSellRepository extends Context.Tag('retail-sell/repository')<RetailSellRepository, ForRetailSellRepository>() {}

// --- Command shapes ---

export interface CreateTransactionReq {
    saleNumb: string
    branchCode: string
    custCode: string
    emplCode: string
    purityId: string
    brandId: string
    productTypeId: string
    brandText: string
    sizeText: string
    weight: number
    pricePerGb: number
    goldPriceSnapshot: number
    settlementPeriod: string
    recordedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: RetailSellStatus
    note?: string
    updatedBy: string
}

// --- Valid transitions ---

export const allowedTransitions: Record<RetailSellStatus, RetailSellStatus[]> = {
    DRAFT:     ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['SHIPPED',   'CANCELLED'],
    SHIPPED:   [],
    CANCELLED: [],
}
