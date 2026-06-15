import { date, decimal, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, originEnum, productTypes, purities } from "./master.schema.js";

export const gainReasonEnum = pgEnum('gain_reason', ['stock_count_gain', 'correction'])
export const lossReasonEnum = pgEnum('loss_reason', ['stock_count_loss', 'damage', 'lost', 'correction'])

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

    movedAt: timestamp().notNull().defaultNow(),
    movedBy: varchar().notNull(),
})

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
    totalCost: decimal({ mode: 'number' }).notNull(),
    reason: gainReasonEnum().notNull(),
    notes: text(),
    auditedBy: varchar().notNull(),
    auditedAt: timestamp().notNull().defaultNow(),
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
    reason: lossReasonEnum().notNull(),
    notes: text(),
    auditedBy: varchar().notNull(),
    auditedAt: timestamp().notNull().defaultNow(),
})

export type CreateStockLoss = typeof stockLossAdjustments.$inferInsert;
export type StockLossShape = typeof stockLossAdjustments.$inferSelect;

// product switch: moves weight from non-fungible brand pool to fungible ('NA') pool
export const productSwitchAdjustments = pgTable('product_switch_adjustments', {
    id: uuid().primaryKey().defaultRandom(),
    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    fromBrandId: varchar().notNull().references(() => brands.id),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    fromCostDelta: decimal({ mode: 'number' }).notNull(),
    toCostDelta: decimal({ mode: 'number' }).notNull(),
    notes: text(),
    switchedBy: varchar().notNull(),
    switchedAt: timestamp().notNull().defaultNow(),
})

export type CreateProductSwitch = typeof productSwitchAdjustments.$inferInsert;
export type ProductSwitchShape = typeof productSwitchAdjustments.$inferSelect;

// end-of-day snapshot — write-once per pool per day (INSERT … ON CONFLICT DO NOTHING)
// brandId is NOT NULL; 99.9% goldbar uses 'NA' sentinel to keep composite PK valid
export const inventoryDailySnapshots = pgTable('inventory_daily_snapshots', {
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    origin: originEnum().notNull(),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    snapshotDate: date().notNull(),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    totalCost: decimal({ mode: 'number' }).notNull(),
}, (table) => [
    primaryKey({
        columns: [table.purityId, table.brandId, table.origin, table.productTypeId, table.snapshotDate]
    })
])

export type SnapshotShape = typeof inventoryDailySnapshots.$inferSelect;
export type CreateSnapshot = typeof inventoryDailySnapshots.$inferInsert;
