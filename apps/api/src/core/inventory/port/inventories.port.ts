import { Context, Data, Effect } from "effect";
import {
    BalanceShape, CreateMovement, CreateProductSwitch, CreateStockGain, CreateStockLoss,
    MovementShape, ProductSwitchShape, UpsertBalance,
} from "../../../infrastructure/db/schema/inventory.schema.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";

// --- Domain errors ---

export class InsufficientStockError extends Data.TaggedError("InsufficientStockError")<{
    requested: number
    available: number
}> {}

// --- Repository port (outbound) ---

export type BalanceKey = Pick<BalanceShape, 'purityId' | 'brandId' | 'origin' | 'productTypeId'>
export type MovementFilter = Partial<Pick<MovementShape, 'purityId' | 'brandId' | 'origin' | 'productTypeId' | 'referenceType'>>
    & { from?: string; to?: string }

// per-purity opening balance (sum of movement deltas strictly before `from`) — seeds the
// running cumulative on the movements page
export type MovementOpening = { purityId: string; weightGb: number; weightGm: number }

export interface ForInventoriesRepository {
    listBalances(): Effect.Effect<BalanceShape[], RepositoryError>
    getBalance(key: BalanceKey): Effect.Effect<BalanceShape | null, RepositoryError>
    upsertBalance(req: UpsertBalance): Effect.Effect<void, RepositoryError>
    // returns the cost removed, derived from the pool's live WAC inside the locked transaction
    decrementBalance(key: BalanceKey, weightGb: number, weightGm: number): Effect.Effect<number, RepositoryError | InsufficientStockError>
    createMovement(req: CreateMovement): Effect.Effect<void, RepositoryError>
    createStockGainAdjustment(req: CreateStockGain): Effect.Effect<void, RepositoryError>
    createStockLossAdjustment(req: CreateStockLoss): Effect.Effect<void, RepositoryError>
    createProductSwitchAdjustment(req: CreateProductSwitch): Effect.Effect<ProductSwitchShape, RepositoryError>
    findMovementsByReference(referenceType: string, referenceId: string): Effect.Effect<MovementShape[], RepositoryError>
    listMovements(filter: MovementFilter): Effect.Effect<MovementShape[], RepositoryError>
    // per-purity sum of deltas strictly before filter.from (respecting the same non-date filters);
    // empty when filter.from is absent
    sumMovementsBefore(filter: MovementFilter): Effect.Effect<MovementOpening[], RepositoryError>
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
    weight: number
    notes?: string
}

export type { ProductSwitchShape };
