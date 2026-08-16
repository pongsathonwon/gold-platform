import { date, decimal, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
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
    pricePerGb: decimal({ mode: 'number' }).notNull(),
    totalCost: decimal({ mode: 'number' }).notNull(),
    referenceType: varchar().notNull(),
    notes: text(),
    // the day the correction is being made *for* — a Friday stock count typed up on Monday is
    // Friday's. Defaults to today; `auditedAt` below is when the row was actually written.
    transactionDate: date({ mode: 'string' }).notNull(),
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
    referenceType: varchar().notNull(),
    notes: text(),
    // as on the gain side — the day the loss belongs to, not the day it was typed
    transactionDate: date({ mode: 'string' }).notNull(),
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
