import { Context, Data, Effect } from "effect";
import { CreateLot, CreateMovement, CreateStockGain, CreateStockLoss, LotShape, MovementShape } from "../../../infrastructure/db/schema/inventory.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

// --- Domain errors ---

export class InsufficientStockError extends Data.TaggedError("InsufficientStockError")<{
    requested: number
    available: number
}> {}

// --- Repository port (outbound) ---

export interface ForInventoriesRepository {
    listLots(req: Partial<LotShape>): Effect.Effect<LotShape[], RepositoryError>
    findLotById(id: string): Effect.Effect<LotShape, RepositoryError>
    createLot(req: CreateLot): Effect.Effect<LotShape, RepositoryError>
    // remainingCost must always move with remainingWeightGb to preserve the lot invariant
    updateLotRemaining(req: Pick<LotShape, 'id' | 'remainingWeightGb' | 'remainingCost'>): Effect.Effect<void, RepositoryError>
    createMovement(req: CreateMovement): Effect.Effect<void, RepositoryError>
    createStockGainAdjustment(req: CreateStockGain): Effect.Effect<void, RepositoryError>
    createStockLossAdjustment(req: CreateStockLoss): Effect.Effect<void, RepositoryError>
    findLotsByFifo(req: Pick<LotShape, 'brandId' | 'purityId' | 'productTypeId'>): Effect.Effect<LotShape[], RepositoryError>
    findMovementsByReference(referenceType: string, referenceId: string): Effect.Effect<MovementShape[], RepositoryError>
}

export class InventoriesRepository extends Context.Tag('inventories/repository')<InventoriesRepository, ForInventoriesRepository>() {}

// --- Shared request shapes ---

export interface InventoryVolume {
    brandId: string
    purityId: string
    productTypeId: string
    totalWeightGb: number
    totalWeightGm: number
    totalCost: number
}

// Internal cross-domain command shapes

export interface IncrementReq {
    sourceId: string
    purityId: string
    brandId: string
    productTypeId: string
    weightGb: number
    weightGm: number
    conversionFactor: number
    totalCost: number
    referenceType: string
    referenceId: string
    createdBy: string
}

export interface DecrementReq {
    purityId: string
    brandId: string
    productTypeId: string
    weightGb: number
    weightGm: number
    referenceType: string
    referenceId: string
    movedBy: string
}

// reverseDecrement locates touched lots via original movements
export interface ReverseDecrementReq {
    originalReferenceType: string
    originalReferenceId: string
    reverseReferenceType: string
    reverseReferenceId: string
    movedBy: string
}
