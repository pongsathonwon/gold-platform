import { Context, Data, Effect } from "effect";
import {
    BalanceShape, CreateMovement, CreateProductSwitch, CreateSnapshot, CreateStockGain, CreateStockLoss,
    MovementShape, ProductSwitchShape, SnapshotShape, UpsertBalance,
} from "../../../infrastructure/db/schema/inventory.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

// --- Domain errors ---

export class InsufficientStockError extends Data.TaggedError("InsufficientStockError")<{
    requested: number
    available: number
}> {}

export class NoSnapshotError extends Data.TaggedError("NoSnapshotError")<{
    purityId: string
    brandId: string
    origin: string
    productTypeId: string
    date: string
}> {}

// --- Repository port (outbound) ---

export type BalanceKey = Pick<BalanceShape, 'purityId' | 'brandId' | 'origin' | 'productTypeId'>
export type SnapshotKey = Pick<SnapshotShape, 'purityId' | 'brandId' | 'origin' | 'productTypeId'>

export interface ForInventoriesRepository {
    listBalances(): Effect.Effect<BalanceShape[], RepositoryError>
    getBalance(key: BalanceKey): Effect.Effect<BalanceShape | null, RepositoryError>
    upsertBalance(req: UpsertBalance): Effect.Effect<void, RepositoryError>
    decrementBalance(key: BalanceKey, weightGb: number, weightGm: number, costDelta: number): Effect.Effect<void, RepositoryError | InsufficientStockError>
    createMovement(req: CreateMovement): Effect.Effect<void, RepositoryError>
    createStockGainAdjustment(req: CreateStockGain): Effect.Effect<void, RepositoryError>
    createStockLossAdjustment(req: CreateStockLoss): Effect.Effect<void, RepositoryError>
    getDailySnapshot(key: SnapshotKey, date: string): Effect.Effect<SnapshotShape | null, RepositoryError>
    listSnapshotsByDate(date: string): Effect.Effect<SnapshotShape[], RepositoryError>
    upsertDailySnapshotOnce(req: CreateSnapshot): Effect.Effect<void, RepositoryError>
    computeAllSnapshots(date: string): Effect.Effect<SnapshotShape[], RepositoryError>
    createProductSwitchAdjustment(req: CreateProductSwitch): Effect.Effect<ProductSwitchShape, RepositoryError>
    findMovementsByReference(referenceType: string, referenceId: string): Effect.Effect<MovementShape[], RepositoryError>
}

export class InventoriesRepository extends Context.Tag('inventories/repository')<InventoriesRepository, ForInventoriesRepository>() {}

// --- Shared request shapes ---

export interface InventoryVolume {
    purityId: string
    brandId: string
    origin: string
    productTypeId: string
    totalWeightGb: number
    totalWeightGm: number
    totalCost: number
}

// Internal cross-domain command shapes

export interface IncrementReq {
    purityId: string
    brandId: string
    origin: 'domestic' | 'foreign'
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
    origin: 'domestic' | 'foreign'
    productTypeId: string
    weightGb: number
    weightGm: number
    referenceType: string
    referenceId: string
    movedBy: string
}

// reverseDecrement locates movements via original reference and restores balance delta
export interface ReverseDecrementReq {
    originalReferenceType: string
    originalReferenceId: string
    reverseReferenceType: string
    reverseReferenceId: string
    movedBy: string
}

export interface ProductSwitchReq {
    purityId: string
    productTypeId: string
    fromBrandId: string
    weightGb: number
    weightGm: number
    notes?: string
}

export type { ProductSwitchShape };
