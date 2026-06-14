import { Context, Data, Effect } from "effect";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateReceivedStatus, CreateReceivedTransaction,
    ReceivedStatus, ReceivedStatusShape, ReceivedTransactionShape,
} from "../../../infrastructure/db/schema/received.schema.js";

// --- Domain errors ---

export class TransactionNotFoundError extends Data.TaggedError("ReceivedTransactionNotFoundError")<{
    id: string
}> {}

export class InvalidTransitionError extends Data.TaggedError("ReceivedInvalidTransitionError")<{
    from: ReceivedStatus
    to: ReceivedStatus
}> {}

export class GracePeriodExpiredError extends Data.TaggedError("ReceivedGracePeriodExpiredError")<{}> {}

// --- Repository port (outbound) ---

export interface ForReceiveRepository {
    createTransaction(req: CreateReceivedTransaction): Effect.Effect<ReceivedTransactionShape, RepositoryError>
    findTransactionById(id: string): Effect.Effect<ReceivedTransactionShape, RepositoryError | TransactionNotFoundError>
    listTransactions(req: Partial<Pick<ReceivedTransactionShape, 'currentStatus' | 'settlementPeriod' | 'branchCode'>>): Effect.Effect<ReceivedTransactionShape[], RepositoryError>
    updateCurrentStatus(id: string, status: ReceivedStatus): Effect.Effect<void, RepositoryError>
    createStatus(req: CreateReceivedStatus): Effect.Effect<void, RepositoryError>
    listStatuses(transactionId: string): Effect.Effect<ReceivedStatusShape[], RepositoryError>
    findReceivedStatusEntry(transactionId: string): Effect.Effect<ReceivedStatusShape, RepositoryError | TransactionNotFoundError>
}

export class ReceiveRepository extends Context.Tag('receive/repository')<ReceiveRepository, ForReceiveRepository>() {}

// --- Command shapes ---

export interface CreateTransactionReq {
    branchCode: string
    purityId: string
    brandId: string
    productTypeId: string
    weight: number
    totalCost: number
    settlementPeriod: string
    recordedBy: string
}

export interface AdvanceStatusReq {
    transactionId: string
    toStatus: ReceivedStatus
    note?: string
    updatedBy: string
}

// --- Valid transitions ---

export const allowedTransitions: Record<ReceivedStatus, ReceivedStatus[]> = {
    RECEIVED:  ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: [],
    CANCELLED: [],
}

export const GRACE_PERIOD_MS = 2 * 60 * 60 * 1000 // 2 hours
