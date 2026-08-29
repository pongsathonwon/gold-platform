import { decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, productTypes, purities } from "./master.schema.js";

export const receivedStatusEnum = pgEnum('received_status', [
    'RECEIVED',
    'CONFIRMED',
    'CANCELLED',
])

export const receivedTransactions = pgTable('received_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    branchCode: varchar().notNull(),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // snapshotted at creation, never updated
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(),

    // management-calculated value, required at creation
    totalCost: decimal({ mode: 'number' }).notNull(),

    settlementPeriod: varchar().notNull(),

    // write-through cache of the latest status row
    currentStatus: receivedStatusEnum().notNull().default('RECEIVED'),

    recordedBy: varchar().notNull(),
    recordedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export type CreateReceivedTransaction = typeof receivedTransactions.$inferInsert;
export type ReceivedTransactionShape = typeof receivedTransactions.$inferSelect;
export type ReceivedStatus = ReceivedTransactionShape['currentStatus'];

// append-only status log — never updated or deleted
export const receivedStatuses = pgTable('received_statuses', {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid().notNull().references(() => receivedTransactions.id),

    status: receivedStatusEnum().notNull(),
    note: text(),

    createdBy: varchar().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export type CreateReceivedStatus = typeof receivedStatuses.$inferInsert;
export type ReceivedStatusShape = typeof receivedStatuses.$inferSelect;
