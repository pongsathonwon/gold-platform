import { decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { branches, brands, productTypes, purities } from "./master.schema.js";

export const retailBuyStatusEnum = pgEnum('retail_buy_status', [
    'DRAFT',
    'CONFIRMED',
    'CANCELLED',
])

export const retailBuyTransactions = pgTable('retail_buy_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    buyNumb: varchar().unique().notNull(), // legacy system transaction number — used for sync
    branchCode: varchar().notNull().references(() => branches.branchCode),
    custCode: varchar().notNull(), // legacy customer ID — no FK until customer domain exists
    emplCode: varchar().notNull(), // cashier employee ID — no FK until employee domain exists

    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // raw strings from legacy system — sync service owns the mapping to master data IDs
    brandText: varchar().notNull(),
    sizeText: varchar().notNull(),

    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(), // GB * factor = GM, snapshotted from unit_conversions

    pricePerGb: decimal({ mode: 'number' }).notNull(),
    goldPriceSnapshot: decimal({ mode: 'number' }).notNull(), // market gold price at transaction time
    totalAmount: decimal({ mode: 'number' }).notNull(), // weightGb * pricePerGb, computed at creation

    settlementPeriod: varchar().notNull(), // week index Fri–Thu e.g. "2026-W24"

    // write-through cache of the latest status row — recomputable from retail_buy_statuses
    currentStatus: retailBuyStatusEnum().notNull().default('DRAFT'),

    recordedBy: varchar().notNull(),
    recordedAt: timestamp().defaultNow().notNull(),
})

export type CreateRetailBuyTransaction = typeof retailBuyTransactions.$inferInsert;
export type RetailBuyTransactionShape = typeof retailBuyTransactions.$inferSelect;
export type RetailBuyStatus = RetailBuyTransactionShape['currentStatus'];

// append-only status log — never updated or deleted
export const retailBuyStatuses = pgTable('retail_buy_statuses', {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid().notNull().references(() => retailBuyTransactions.id),

    status: retailBuyStatusEnum().notNull(),
    note: text(), // required when CANCELLED, optional otherwise

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateRetailBuyStatus = typeof retailBuyStatuses.$inferInsert;
export type RetailBuyStatusShape = typeof retailBuyStatuses.$inferSelect;
