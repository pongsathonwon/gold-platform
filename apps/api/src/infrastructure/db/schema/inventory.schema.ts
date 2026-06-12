import { date, decimal, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, productTypes, purities } from "./master.schema.js";


export const inventoryAdjustments = pgTable('inventory_adjustments', {
    id: uuid().primaryKey(),
    lotId: uuid().notNull().references(() => inventoryLots.id),
    reason: text().notNull(),
    auditedBy: varchar().notNull(),
    auditedAt: timestamp().notNull().defaultNow(),
})

export type CreateAdjustment = typeof inventoryAdjustments.$inferInsert;
export type AdjustmentShape = typeof inventoryAdjustments.$inferSelect;

export const inventoryLots = pgTable('inventory_lots', {
    id: uuid().primaryKey(),
    sourceType: varchar().notNull(), // RECEIVED | ADJUSTMENT
    sourceId: uuid().notNull(),      // fk to received_transactions or inventory_adjustments

    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // original values — immutable after creation
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(),
    totalCost: decimal({ mode: 'number' }).notNull(),

    // mutable — updated on each movement in the same transaction
    remainingWeightGb: decimal({ mode: 'number' }).notNull(),

    // TODO: add lot status enum (active | reserved | transferring | void)

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateLot = typeof inventoryLots.$inferInsert;
export type LotShape = typeof inventoryLots.$inferSelect;

// append-only ledger
export const inventoryMovements = pgTable('inventory_movements', {
    id: uuid().primaryKey(),
    lotId: uuid().notNull().references(() => inventoryLots.id),
    movementType: varchar().notNull(), // RECEIVED | ADJUSTMENT | FULFILLMENT | VOID | TRANSFER
    referenceType: varchar().notNull(), // which table to look up
    referenceId: uuid().notNull(),      // fk to the source event record

    // signed deltas — positive = stock in, negative = stock out
    weightGbDelta: decimal({ mode: 'number' }).notNull(),
    weightGmDelta: decimal({ mode: 'number' }).notNull(),

    // TODO: add fromStatus / toStatus once lot status enum is defined

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
