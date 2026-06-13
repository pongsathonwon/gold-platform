import { Context, Data, Effect } from "effect";
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

// --- Repository port (outbound) ---

export interface ForWholeBuyRepository {
    createTransaction(req: CreateWholeBuyTransaction): Effect.Effect<WholeBuyTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<WholeBuyTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: Partial<Pick<WholeBuyTransactionShape, 'currentStatus' | 'settlementPeriod'>>): Effect.Effect<WholeBuyTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: WholeBuyStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateWholeBuyStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<WholeBuyStatusShape[], RepositoryError>
}

export class WholeBuyRepository extends Context.Tag('wholesale-buy/repository')<WholeBuyRepository, ForWholeBuyRepository>() {}

// --- Command shapes ---

export interface CreateTransactionReq {
    supplierId: string
    purityId: string
    brandId: string
    productTypeId: string
    weightGb: number
    weightGm: number
    conversionFactor: number
    pricePerGb: number
    settlementPeriod: string
    recordedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: WholeBuyStatus
    note?: string
    updatedBy: string
}

// --- Valid transitions ---

export const allowedTransitions: Record<WholeBuyStatus, WholeBuyStatus[]> = {
    DRAFT:     ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['RECEIVED',  'CANCELLED'],
    RECEIVED:  ['SETTLED'],
    SETTLED:   [],
    CANCELLED: [],
}
