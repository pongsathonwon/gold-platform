import { decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { brands, productTypes, purities, suppliers } from "./master.schema.js";

// Happy path:  CREATED → CONFIRMED → PAID → RECEIVED → CHECKED
// Failure branches:
//   CANCELLED       we backed out while the order was still CREATED
//   REJECTED        the supplier declined — counterparty killed it, tracked separately from CANCELLED
//   PAYMENT_FAILED  transfer bounced or the amount was wrong; retryable back to PAID
//   DELIVERY_FAILED we paid and the goods never turned up; resolves to RECEIVED or WRITTEN_OFF
//   DISPUTED        goods arrived but failed verification; resolves to CHECKED or RETURNED
//   RETURNED        shipment sent back to the supplier — nothing ever enters inventory
//   WRITTEN_OFF     we paid, nothing ever arrived, and we gave up chasing it
// Legacy mapping: CREATED = old system status 1, CONFIRMED = old system status 2.
export const wholeBuyStatusEnum = pgEnum('whole_buy_status', [
    'CREATED',
    'CONFIRMED',
    'PAID',
    'RECEIVED',
    'CHECKED',
    'PAYMENT_FAILED',
    'DELIVERY_FAILED',
    'DISPUTED',
    'CANCELLED',
    'REJECTED',
    'RETURNED',
    'WRITTEN_OFF',
])

// One item per transaction — no line-item table. A multi-item order is multiple transactions.
export const wholeBuyTransactions = pgTable('whole_buy_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    supplierId: uuid().notNull().references(() => suppliers.id),
    purityId: varchar().notNull().references(() => purities.id),
    brandId: varchar().notNull().references(() => brands.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // ordered weight — snapshotted at creation, only editable while CREATED
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(), // GB * factor = GM, snapshotted from unit_conversions

    // both quotes are recorded on every transaction whatever the item's purity.
    // 99.9% is quoted off the 96.5% price by the purity ratio (99.9/96.5) — the operator
    // calculates that value, the server stores what they entered.
    // the 96.5% quote keeps its original physical column name (price_per_gb) — it was always
    // this quote, the 965 suffix just makes that explicit now that a second one exists
    pricePerGb965: decimal('price_per_gb', { mode: 'number' }).notNull(),
    pricePerGb999: decimal('price_per_gb_999', { mode: 'number' }).notNull(),
    totalAmount: decimal({ mode: 'number' }).notNull(), // orderedWeightGb * the purity-matched price

    // The measured weight of a delivery that did NOT match the order — set when a check is
    // diverted to DISPUTED, and cleared again if the shipment is later accepted. Null therefore
    // always means "no outstanding discrepancy", which is what a CHECKED transaction must show:
    // acceptance is all-or-nothing, so an accepted delivery equals its order by definition.
    actualWeightGb: decimal({ mode: 'number' }),
    actualWeightGm: decimal({ mode: 'number' }),
    actualAmount: decimal({ mode: 'number' }), // actualWeightGb * the purity-matched price

    settlementPeriod: varchar().notNull(), // Fri–Thu week index e.g. "2026-W24", derived from recordedAt

    // write-through cache of the latest status row — recomputable from whole_buy_statuses
    currentStatus: wholeBuyStatusEnum().notNull().default('CREATED'),

    // recordedAt + the configured edit window. While CREATED and before this instant the
    // transaction can still be edited; past it the auto-confirm job moves it to CONFIRMED.
    confirmDueAt: timestamp().notNull(),

    notes: text(),

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
    note: text(), // required on every failure-branch transition, optional on the happy path

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateWholeBuyStatus = typeof wholeBuyStatuses.$inferInsert;
export type WholeBuyStatusShape = typeof wholeBuyStatuses.$inferSelect;
