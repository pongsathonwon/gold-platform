import { pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { branches } from "./master.schema.js";

export const receivedStatusEnum = pgEnum('received_status', ['pending', 'completed', 'rejected'])

// receiving product from supplier via branch
export const receivedTransactions = pgTable('received_transactions', {
    id: uuid().primaryKey(),
    branchCode: varchar().notNull().references(() => branches.branchCode),
    status: receivedStatusEnum().notNull().default('pending'),
    receivedAt: timestamp().notNull(),
    receivedBy: varchar().notNull(),
    insertedAt: timestamp().notNull().defaultNow(), // record may be retrograde — use for audit
    notes: text(),
    // lot is created when status transitions to completed
    // inventory_lots.sourceId → this record's id
})

export type CreateReceivedTransaction = typeof receivedTransactions.$inferInsert;
export type ReceivedTransactionShape = typeof receivedTransactions.$inferSelect;
