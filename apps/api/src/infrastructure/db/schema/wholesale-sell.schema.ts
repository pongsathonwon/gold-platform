import { decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { productTypes, purities, suppliers } from "./master.schema.js";

// Happy path:  CREATED → CONFIRMED → PACKED → SHIPPED → PAID
// Inventory decrements on entering PACKED — gold stops being ours when it leaves the vault,
// not when it ships and not when the money lands.
// Failure branches:
//   CANCELLED       we backed out — reachable while CREATED or CONFIRMED, before any gold moves
//   REJECTED        the buyer declined — counterparty killed it, tracked separately from CANCELLED
//   DISPUTED        the buyer contests the weight after it shipped; resolves to PAID or RETURNED
//   RETURNED        the gold came home — the decrement is REVERSED, putting the stock back
//   PAYMENT_FAILED  the buyer's transfer bounced or came up short; retryable back to PAID
//   WRITTEN_OFF     the receivable was given up on. The gold is gone and no money came for it.
// Mirrors whole_buy_status: PACKED/SHIPPED pair off against RECEIVED/STOCKED, and the payment
// failure branch sits after the goods move rather than before it.
export const wholeSellStatusEnum = pgEnum('whole_sell_status', [
    'CREATED',
    'CONFIRMED',
    'PACKED',
    'SHIPPED',
    'PAID',
    'DISPUTED',
    'PAYMENT_FAILED',
    'CANCELLED',
    'REJECTED',
    'RETURNED',
    'WRITTEN_OFF',
])

// Why a shipment came back. Its own type rather than one shared with wholesale-buy, for the same
// reason the two status enums are separate: each domain owns its schema outright.
export const wholeSellReturnReasonEnum = pgEnum('whole_sell_return_reason', [
    'WEIGHT',
    'BRAND',
    'PURITY',
    'DAMAGED',
    'OTHER',
])

// One item per transaction — no line-item table. A multi-item deal is multiple transactions.
export const wholeSellTransactions = pgTable('whole_sell_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    supplierId: uuid().notNull().references(() => suppliers.id),
    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // No brand column, mirroring the buy side for the mirror-image reason: which stamps we hand
    // over is decided when the vault is opened, out of whatever is on the shelf. The split is
    // recorded on the move into PACKED as one decrement per pool, and the ledger is the record —
    // which is also what lets RETURNED reverse a mixed shipment pool by pool.

    // agreed weight — snapshotted at creation, only editable while CREATED
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(), // GB * factor = GM, snapshotted from unit_conversions

    // both quotes are recorded on every transaction whatever the item's purity. The operator
    // enters only the 96.5% one; the 99.9% one is derived from it by the purity ratio.
    // the 96.5% quote keeps its original physical column name (price_per_gb) — it was always
    // this quote, the 965 suffix just makes that explicit now that a second one exists
    pricePerGb965: decimal('price_per_gb', { mode: 'number' }).notNull(),
    pricePerGb999: decimal('price_per_gb_999', { mode: 'number' }).notNull(),
    totalAmount: decimal({ mode: 'number' }).notNull(), // agreedWeightGb * the purity-matched price

    // The weight the buyer contests, recorded when a shipped deal is moved to DISPUTED. Packing
    // records nothing here — we boxed our own gold from our own vault, so there is no second,
    // independent measurement to capture. Null therefore means "nobody is arguing", and the only
    // thing that can ever populate it is the buyer's own re-weigh.
    actualWeightGb: decimal({ mode: 'number' }),
    actualWeightGm: decimal({ mode: 'number' }),
    actualAmount: decimal({ mode: 'number' }), // actualWeightGb * the purity-matched price

    // What the buyer actually settled, when it differed from totalAmount. Null means it matched.
    // BU's rare "we took less and closed the file" case: a recorded variance, not a status, since
    // an accepted shortfall ends the deal exactly like an exact payment does.
    settledAmount: decimal({ mode: 'number' }),

    // Why the shipment came home; set on the move into RETURNED, alongside the mandatory note.
    returnReason: wholeSellReturnReasonEnum(),

    settlementPeriod: varchar().notNull(), // Fri–Thu week index e.g. "2026-W24", derived from recordedAt

    // write-through cache of the latest status row — recomputable from whole_sell_statuses
    currentStatus: wholeSellStatusEnum().notNull().default('CREATED'),

    // when the next bulk-confirm sweep lands. While CREATED the transaction is editable; the
    // sweep is what ends that. Informational only — nothing in the API tests against it.
    confirmDueAt: timestamp().notNull(),

    notes: text(),

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
    note: text(), // required on every failure-branch transition, optional on the happy path

    createdBy: varchar().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateWholeSellStatus = typeof wholeSellStatuses.$inferInsert;
export type WholeSellStatusShape = typeof wholeSellStatuses.$inferSelect;
