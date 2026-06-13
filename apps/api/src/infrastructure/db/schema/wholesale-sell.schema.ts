import { decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, productTypes, purities, suppliers } from "./master.schema.js";

export const wholeSellStatusEnum = pgEnum('whole_sell_status', [
    'DRAFT',
    'CONFIRMED',
    'SHIPPED',
    'SETTLED',
    'CANCELLED',
])

export const wholeSellTransactions = pgTable('whole_sell_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    supplierId: uuid().notNull().references(() => suppliers.id),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // agreed weight — snapshotted at creation, never updated
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(), // GB * factor = GM, snapshotted from unit_conversions

    pricePerGb: decimal({ mode: 'number' }).notNull(),
    totalAmount: decimal({ mode: 'number' }).notNull(), // weightGb * pricePerGb, computed at creation

    settlementPeriod: varchar().notNull(), // week index Fri–Thu e.g. "2026-W24"

    // write-through cache of the latest status row — recomputable from whole_sell_statuses
    currentStatus: wholeSellStatusEnum().notNull().default('DRAFT'),

    recordedBy: varchar().notNull(),
    recordedAt: timestamp().defaultNow().notNull(),
})

export type CreateWholeSellTransaction = typeof wholeSellTransactions.$inferInsert;
export type WholeSellTransactionShape = typeof wholeSellTransactions.$inferSelect;
export type WholeSellStatus = WholeSellTransactionShape['currentStatus'];

// append-only status log — never updated or deleted
export const wholeSellStatuses = pgTable('whole_sell_statuses', {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid().notNull().references(() => wholeSellTransactions.id),

    status: wholeSellStatusEnum().notNull(),
    note: text(), // required when CANCELLED, optional otherwise

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateWholeSellStatus = typeof wholeSellStatuses.$inferInsert;
export type WholeSellStatusShape = typeof wholeSellStatuses.$inferSelect;
