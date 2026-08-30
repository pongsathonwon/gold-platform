import { date, decimal, index, uniqueIndex, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, originEnum, productTypes, purities } from "./master.schema.js";

// aggregate balance — one row per pool (purityId, brandId, origin, productTypeId)
// 99.9% goldbar uses brandId='NA' as sentinel; origin is the meaningful pool key
export const inventoryBalance = pgTable('inventory_balance', {
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    origin: originEnum().notNull(),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    totalWeightGb: decimal({ mode: 'number' }).notNull().default(0),
    totalWeightGm: decimal({ mode: 'number' }).notNull().default(0),
    totalCost: decimal({ mode: 'number' }).notNull().default(0),
}, (table) => [
    primaryKey({ columns: [table.purityId, table.brandId, table.origin, table.productTypeId] })
])

export type BalanceShape = typeof inventoryBalance.$inferSelect
export type UpsertBalance = typeof inventoryBalance.$inferInsert

// append-only ledger — fired by transaction status changes, never standalone
export const inventoryMovements = pgTable('inventory_movements', {
    id: uuid().primaryKey(),

    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    origin: originEnum().notNull(),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    referenceType: varchar().notNull(),
    referenceId: uuid().notNull(),

    weightGbDelta: decimal({ mode: 'number' }).notNull(),
    weightGmDelta: decimal({ mode: 'number' }).notNull(),
    costDelta: decimal({ mode: 'number' }).notNull(),
    notes: text(),

    // The trading day this movement belongs to. It is what the movement report windows on, so a
    // gain or loss written up two days late still reads on the day it happened.
    //
    // For movements booked by a transaction's own transitions (a buy reaching STOCKED, a sell
    // reaching PACKED) this is simply the day of the transition — the metal moved when it moved,
    // whatever date the order carries. Only the manual adjustment forms let an operator pick it.
    movementDate: date({ mode: 'string' }).notNull(),

    // when the row was written — the bookkeeping instant, kept for ordering within a day
    movedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    movedBy: varchar().notNull(),
}, (table) => [
    /**
     * The ledger's only access pattern, and the one the table had no index for at all.
     *
     * Its columns are exactly `listMovements`'s window and sort — `movementDate` bounded by
     * from/to, then `(movedAt, id)` breaking ties inside a day — so the range scan and the
     * ordering come from one index and neither needs a sort step.
     *
     * It also covers `sumMovementsBefore`, which is the half that actually needed help:
     * everything strictly before the window start, aggregated. That scan grows with the age of
     * the ledger rather than with what the caller asked for, so an operator opening the page on
     * yesterday–today reads more rows every month the shop stays in business.
     */
    index('inventory_movements_movement_date_idx').on(table.movementDate, table.movedAt, table.id),
    /**
     * One movement per pool per reference — the constraint that makes a retry safe.
     *
     * Booking stock and writing the status row that records it are separate transactions. A crash
     * between them leaves the movement applied and the transaction still in its old status, so the
     * obvious recovery — repeat the transition — increments the pool a second time. Nothing
     * detects it: both movements are individually valid, the balance is simply wrong, and the
     * ledger reads as two deliveries of gold that arrived once.
     *
     * **Not `(reference_type, reference_id)`**, which is what it looks like it should be and would
     * break every brand split. A mixed delivery books one movement per branded pool under a single
     * reference — that is what `findBrandSplitByReference` reads back, and it is the design. The
     * pool columns are what make each of those rows distinct, so they belong in the key.
     *
     * That leaves exactly one legitimate way to write the same pool twice under one reference, and
     * `divideWeight` no longer does it: the residual is folded into an existing `NA` line rather
     * than pushed beside it.
     *
     * A reversal is a different `reference_type` (`WHOLESALE_SELL_RETURN`), so unwinding a sell
     * never collides with the sell's own rows.
     */
    uniqueIndex('inventory_movements_reference_pool_uq').on(
        table.referenceType,
        table.referenceId,
        table.purityId,
        table.brandId,
        table.origin,
        table.productTypeId,
    ),
])

export type CreateMovement = typeof inventoryMovements.$inferInsert;
export type MovementShape = typeof inventoryMovements.$inferSelect;

// gain: upserts balance + inserts movement
export const stockGainAdjustments = pgTable('stock_gain_adjustments', {
    id: uuid().primaryKey(),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().references(() => brands.id),
    origin: originEnum().notNull(),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(),
    pricePerGb: decimal({ mode: 'number' }).notNull(),
    totalCost: decimal({ mode: 'number' }).notNull(),
    referenceType: varchar().notNull(),
    notes: text(),
    // the day the correction is being made *for* — a Friday stock count typed up on Monday is
    // Friday's. Defaults to today; `auditedAt` below is when the row was actually written.
    transactionDate: date({ mode: 'string' }).notNull(),
    auditedBy: varchar().notNull(),
    auditedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export type CreateStockGain = typeof stockGainAdjustments.$inferInsert;
export type StockGainShape = typeof stockGainAdjustments.$inferSelect;

// loss: decrements balance at WAC snapshot rate
export const stockLossAdjustments = pgTable('stock_loss_adjustments', {
    id: uuid().primaryKey(),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().references(() => brands.id),
    origin: originEnum().notNull(),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    referenceType: varchar().notNull(),
    notes: text(),
    // as on the gain side — the day the loss belongs to, not the day it was typed
    transactionDate: date({ mode: 'string' }).notNull(),
    auditedBy: varchar().notNull(),
    auditedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export type CreateStockLoss = typeof stockLossAdjustments.$inferInsert;
export type StockLossShape = typeof stockLossAdjustments.$inferSelect;

// product switch: moves weight between two brand pools of the same purity + product type, in
// either direction — stamped into fungible ('NA'), or fungible identified as a stamp
export const productSwitchAdjustments = pgTable('product_switch_adjustments', {
    id: uuid().primaryKey().defaultRandom(),
    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    fromBrandId: varchar().notNull().references(() => brands.id),
    toBrandId: varchar().notNull().references(() => brands.id),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    fromCostDelta: decimal({ mode: 'number' }).notNull(),
    toCostDelta: decimal({ mode: 'number' }).notNull(),
    notes: text(),
    switchedBy: varchar().notNull(),
    switchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export type CreateProductSwitch = typeof productSwitchAdjustments.$inferInsert;
export type ProductSwitchShape = typeof productSwitchAdjustments.$inferSelect;
