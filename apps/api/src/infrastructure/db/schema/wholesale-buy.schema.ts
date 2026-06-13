import { decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, productTypes, purities, suppliers } from "./master.schema.js";

export const wholeBuyStatusEnum = pgEnum('whole_buy_status', [
    'DRAFT',
    'CONFIRMED',
    'RECEIVED',
    'SETTLED',
    'CANCELLED',
])

export const wholeBuyTransactions = pgTable('whole_buy_transactions', {
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

    // write-through cache of the latest status row — recomputable from whole_buy_statuses
    currentStatus: wholeBuyStatusEnum().notNull().default('DRAFT'),

    recordedBy: varchar().notNull(),
    recordedAt: timestamp().defaultNow().notNull(),
})

export type CreateWholeBuyTransaction = typeof wholeBuyTransactions.$inferInsert;
export type WholeBuyTransactionShape = typeof wholeBuyTransactions.$inferSelect;
export type WholeBuyStatus = WholeBuyTransactionShape['currentStatus'];

// append-only status log — never updated or deleted
export const wholeBuyStatuses = pgTable('whole_buy_statuses', {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid().notNull().references(() => wholeBuyTransactions.id),

    status: wholeBuyStatusEnum().notNull(),
    note: text(), // required when CANCELLED, optional otherwise

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateWholeBuyStatus = typeof wholeBuyStatuses.$inferInsert;
export type WholeBuyStatusShape = typeof wholeBuyStatuses.$inferSelect;
