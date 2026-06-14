import { date, decimal, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, productTypes, purities } from "./master.schema.js";


export const lotStatusEnum = pgEnum('lot_status', ['active', 'void'])
export const gainReasonEnum = pgEnum('gain_reason', ['stock_count_gain', 'correction'])
export const lossReasonEnum = pgEnum('loss_reason', ['stock_count_loss', 'damage', 'lost', 'correction'])

// gain: creates a new lot — insert adjustment → insert lot → insert movement
export const stockGainAdjustments = pgTable('stock_gain_adjustments', {
    id: uuid().primaryKey(),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
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

// loss: drains existing lots via FIFO — insert adjustment → find lots → insert movements
export const stockLossAdjustments = pgTable('stock_loss_adjustments', {
    id: uuid().primaryKey(),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
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

// discriminator for sourceId FK — each value maps to a different table
export const lotSourceTypeEnum = pgEnum('lot_source_type', ['RECEIVED', 'STOCK_GAIN'])

export const inventoryLots = pgTable('inventory_lots', {
    id: uuid().primaryKey(),

    sourceType: lotSourceTypeEnum().notNull(),
    sourceId: uuid().notNull(),

    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // original values — immutable after creation
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(),
    totalCost: decimal({ mode: 'number' }).notNull(),

    // mutable — updated in the same transaction as each movement
    remainingWeightGb: decimal({ mode: 'number' }).notNull(),
    remainingCost: decimal({ mode: 'number' }).notNull(),
    status: lotStatusEnum().notNull().default('active'),

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateLot = typeof inventoryLots.$inferInsert;
export type LotShape = typeof inventoryLots.$inferSelect;
export type LotSourceType = LotShape['sourceType'];

// append-only ledger — fired by transaction status changes, never standalone
export const inventoryMovements = pgTable('inventory_movements', {
    id: uuid().primaryKey(),
    lotId: uuid().notNull().references(() => inventoryLots.id),

    // caller-provided reference — each domain registers its own type string
    // e.g. RECEIVED | STOCK_GAIN | STOCK_LOSS | WHOLESALE_BUY | WHOLESALE_SELL | RETAIL_SELL
    referenceType: varchar().notNull(),
    referenceId: uuid().notNull(),

    weightGbDelta: decimal({ mode: 'number' }).notNull(),
    weightGmDelta: decimal({ mode: 'number' }).notNull(),
    costDelta: decimal({ mode: 'number' }).notNull(),

    movedAt: timestamp().notNull().defaultNow(),
    movedBy: varchar().notNull(),
})

export type CreateMovement = typeof inventoryMovements.$inferInsert;
export type MovementShape = typeof inventoryMovements.$inferSelect;

// end-of-day snapshot — immutable, append only
export const inventoryDailySnapshots = pgTable('inventory_daily_snapshots', {
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    snapshotDate: date().notNull(),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    totalCost: decimal({ mode: 'number' }).notNull(),
}, (table) => [
    primaryKey({
        columns: [table.purityId, table.brandId, table.productTypeId, table.snapshotDate]
    })
])
