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

export class NoSnapshotError extends Data.TaggedError("NoSnapshotError")<{
    purityId: string
    brandId: string
    origin: string
    productTypeId: string
    date: string
}> {}

// --- Repository port (outbound) ---

export type BalanceKey = Pick<BalanceShape, 'purityId' | 'brandId' | 'origin' | 'productTypeId'>
export type MovementFilter = Partial<Pick<MovementShape, 'purityId' | 'brandId' | 'origin' | 'productTypeId' | 'referenceType'>>
    & { from?: string; to?: string }

// per-purity opening balance (sum of movement deltas strictly before `from`) — seeds the
// running cumulative on the movements page
export type MovementOpening = { purityId: string; weightGb: number; weightGm: number }

// One pool's share of a movement. `totalCost` is the cost entering the pool on an increment and
// is ignored on a decrement, where the pool's own live WAC decides what leaves.
export type MovementEntry = BalanceKey & {
    weightGb: number
    weightGm: number
    totalCost: number
    referenceType: string
    referenceId: string
    movedBy: string
}

export interface ForInventoriesRepository {
    listBalances(): Effect.Effect<BalanceShape[], RepositoryError>
    getBalance(key: BalanceKey): Effect.Effect<BalanceShape | null, RepositoryError>
    upsertBalance(req: UpsertBalance): Effect.Effect<void, RepositoryError>
    // returns the cost removed, derived from the pool's live WAC inside the locked transaction
    decrementBalance(key: BalanceKey, weightGb: number, weightGm: number): Effect.Effect<number, RepositoryError | InsufficientStockError>
    // Balance upsert + movement row for every pool in one DB transaction. A transaction whose
    // gold splits across brands moves several pools at once, and a partial application would
    // book stock the operator never agreed to — so all of them land or none do.
    incrementMany(entries: MovementEntry[]): Effect.Effect<void, RepositoryError>
    // The same all-or-nothing rule on the way out, with each pool's cost taken from its own live
    // WAC inside the shared transaction. One short pool fails the whole move: a half-packed
    // shipment is worse than an unpacked one.
    decrementMany(entries: MovementEntry[]): Effect.Effect<void, RepositoryError | InsufficientStockError>
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

/**
 * One brand's share of a transaction whose gold is split across stamps.
 *
 * `totalCost` is read on the way in and ignored on the way out — an increment carries the cost
 * the buyer paid for that portion, a decrement takes whatever the pool's own live WAC says.
 */
export interface BrandWeight {
    brandId: string
    weightGb: number
    weightGm: number
    totalCost: number
}

/**
 * A stock movement spanning one or more branded pools of the same purity, origin and product type.
 *
 * This is the general shape; `increment`/`decrement` are the single-brand case expressed through
 * it, so every inventory movement in the system goes through the same all-or-nothing path.
 */
export interface SplitMovementReq {
    purityId: string
    origin: 'domestic' | 'foreign'
    productTypeId: string
    brands: BrandWeight[]
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
