import { Context, Data, Effect } from "effect";
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

// --- Repository port (outbound) ---

export interface ForRetailBuyRepository {
    createTransaction(req: CreateRetailBuyTransaction): Effect.Effect<RetailBuyTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<RetailBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: Partial<Pick<RetailBuyTransactionShape, 'currentStatus' | 'settlementPeriod'>>): Effect.Effect<RetailBuyTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: RetailBuyStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateRetailBuyStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<RetailBuyStatusShape[], RepositoryError>
}

export class RetailBuyRepository extends Context.Tag('retail-buy/repository')<RetailBuyRepository, ForRetailBuyRepository>() {}

// --- Command shapes ---

export interface CreateTransactionReq {
    buyNumb: string
    branchCode: string
    custCode: string
    emplCode: string
    purityId: string
    brandId: string
    productTypeId: string
    brandText: string
    sizeText: string
    weightGb: number
    weightGm: number
    conversionFactor: number
    pricePerGb: number
    goldPriceSnapshot: number
    settlementPeriod: string
    recordedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: RetailBuyStatus
    note?: string
    updatedBy: string
}

// --- Valid transitions ---

export const allowedTransitions: Record<RetailBuyStatus, RetailBuyStatus[]> = {
    DRAFT:     ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['CANCELLED'],
    CANCELLED: [],
}
