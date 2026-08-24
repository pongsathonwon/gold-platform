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

/**
 * A manual adjustment named the domestic pool.
 *
 * Domestic stock is smelted in-house: `smelting` is the only thing that creates it and
 * `convert_out` the only thing that may draw it down. That is what makes the pool a meaningful
 * record of what the shop produced itself rather than bought, and a gain or loss writing into it
 * would quietly destroy that distinction. 96.5% has no domestic pool at all.
 *
 * The web forms no longer offer the choice, but the rule belongs here: a UI that stops sending a
 * value is not the same as a server that refuses it.
 */
export class ProtectedOriginError extends Data.TaggedError("ProtectedOriginError")<{
    origin: string
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

/**
 * Every method that moves a balance is a whole operation applied in one database transaction.
 *
 * There are deliberately no primitives here — no bare `upsertBalance`, no bare `createMovement`.
 * A balance and the ledger entry explaining it are two halves of one fact, and exposing either
 * half on its own is what let three usecases drift into applying five autocommitted statements
 * where one transaction was needed. The narrow interface is the guard rail.
 */
export interface ForInventoriesRepository {
    listBalances(): Effect.Effect<BalanceShape[], RepositoryError>
    // Balance upsert + movement row for every pool in one DB transaction. A transaction whose
    // gold splits across brands moves several pools at once, and a partial application would
    // book stock the operator never agreed to — so all of them land or none do.
    incrementMany(entries: MovementEntry[]): Effect.Effect<void, RepositoryError>
    // The same all-or-nothing rule on the way out, with each pool's cost taken from its own live
    // WAC inside the shared transaction. One short pool fails the whole move: a half-packed
    // shipment is worse than an unpacked one.
    decrementMany(entries: MovementEntry[]): Effect.Effect<void, RepositoryError | InsufficientStockError>
    /**
     * The three manual-adjustment operations, each applied as one database transaction.
     *
     * They are exposed as whole operations rather than as the individual writes they are made of
     * because the writes are not independently meaningful: a balance that moved without an
     * adjustment record explaining it, or an audited loss the ledger never saw, is not a partial
     * success but a corruption. The adapter owns the transaction because only the adapter knows
     * what one is.
     */
    applyStockGain(req: {
        adjustment: CreateStockGain
        balance: UpsertBalance
        movement: CreateMovement
    }): Effect.Effect<void, RepositoryError>
    // returns the cost removed, decided by the pool's live WAC inside the locked transaction
    applyStockLoss(req: {
        key: BalanceKey
        weightGb: number
        weightGm: number
        adjustment: CreateStockLoss
        movement: Omit<CreateMovement, 'costDelta'>
    }): Effect.Effect<number, RepositoryError | InsufficientStockError>
    applyProductSwitch(req: {
        from: BalanceKey
        to: BalanceKey
        weightGb: number
        weightGm: number
        adjustment: Omit<CreateProductSwitch, 'fromCostDelta' | 'toCostDelta'>
        fromMovement: Omit<CreateMovement, 'costDelta'>
        toMovement: Omit<CreateMovement, 'costDelta'>
    }): Effect.Effect<ProductSwitchShape, RepositoryError | InsufficientStockError>
    // restores pools and books the opposite movements for a reversed outbound move, atomically
    applyReversal(req: {
        restore: UpsertBalance[]
        movements: CreateMovement[]
    }): Effect.Effect<void, RepositoryError>
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
    toBrandId: string
    weight: number
    notes?: string
}

export type { ProductSwitchShape };
