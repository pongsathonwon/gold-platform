import { date, decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { productTypes, purities, suppliers } from "./master.schema.js";

// Happy path:  CREATED → CONFIRMED → PAID → RECEIVED → STOCKED
// Failure branches:
//   CANCELLED       we backed out — reachable while CREATED or CONFIRMED, and after a failed payment
//   REJECTED        the supplier declined — counterparty killed it, tracked separately from CANCELLED
//   PAYMENT_FAILED  transfer bounced or the amount was wrong; retryable back to PAID
//   DELIVERY_FAILED we paid and the goods never turned up; resolves to RECEIVED or WRITTEN_OFF
//   DISPUTED        goods were taken in and then failed verification; resolves to STOCKED or RETURNED
//   RETURNED        shipment went back — refused at the door from PAID, or sent back from DISPUTED.
//                   Not terminal: our money is still with the supplier until it resolves.
//   REFUNDED        the supplier gave the money back — the clean close of a return
//   WRITTEN_OFF     our money left, nothing came back, and we gave up chasing it
// Legacy mapping: CREATED = old system status 1, CONFIRMED = old system status 2.
export const wholeBuyStatusEnum = pgEnum('whole_buy_status', [
    'CREATED',
    'CONFIRMED',
    'PAID',
    'RECEIVED',
    'STOCKED',
    'PAYMENT_FAILED',
    'DELIVERY_FAILED',
    'DISPUTED',
    'CANCELLED',
    'REJECTED',
    'RETURNED',
    'REFUNDED',
    'WRITTEN_OFF',
])

// Why a shipment went back. Kept as its own type per domain rather than shared with
// wholesale-sell: the two domains own their schemas outright, which is the same reason their
// endpoints and status enums are not merged either.
export const wholeBuyReturnReasonEnum = pgEnum('whole_buy_return_reason', [
    'WEIGHT',
    'BRAND',
    'PURITY',
    'DAMAGED',
    'OTHER',
])

// One item per transaction — no line-item table. A multi-item order is multiple transactions.
export const wholeBuyTransactions = pgTable('whole_buy_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    supplierId: uuid().notNull().references(() => suppliers.id),
    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),

    // No brand column. An order cannot state what stamp will arrive — that is an observation made
    // when the metal is on the counter, and from a supplier without brandLock it is routinely a
    // mix. The split is recorded on the move into STOCKED as one inventory movement per pool, so
    // the ledger holding the balances is also the record of what was stamped what. A column here
    // would be a second copy of those same numbers, free to drift from them.

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

    // The measured weight of a delivery we took in and then contested — written only on a move
    // into DISPUTED, and cleared again if the shipment is later accepted. Null therefore always
    // means "nobody is arguing", which is what a STOCKED transaction must show: acceptance means
    // the delivery matched its document, so there is no second weight to carry.
    //
    // Accepting never writes here. The weight check happens at the door before custody transfers,
    // and a delivery that fails it is refused (PAID → RETURNED) rather than measured and booked.
    actualWeightGb: decimal({ mode: 'number' }),
    actualWeightGm: decimal({ mode: 'number' }),
    actualAmount: decimal({ mode: 'number' }), // actualWeightGb * the purity-matched price

    // What was actually paid, when it differed from totalAmount. Null means the payment matched.
    // Recorded on the move into PAID and never branched on — an accepted variance closes the deal
    // exactly like an exact payment, so it is a number accounting needs, not a state anyone works.
    settledAmount: decimal({ mode: 'number' }),

    // Why the shipment went back; set on the move into RETURNED, alongside the mandatory note.
    // A column rather than prose because supplier reliability has to be reportable.
    returnReason: wholeBuyReturnReasonEnum(),

    // The day the order was placed, as the operator states it — which is not necessarily the day
    // this row was written. Two dates, because recording an event and the event happening are two
    // different things: `transactionDate` is the business fact, `recordedAt` below is the
    // bookkeeping fact. Under a proper workflow they agree; on day one, and any morning-after
    // entry, they do not, and the gap is exactly the audit trail worth keeping.
    //
    // A `date`, not a `timestamp`: the only thing it decides is which Fri–Thu period the order
    // falls in, and that boundary is a day boundary. A time of day would add no information to it
    // and one more timezone to get wrong.
    transactionDate: date({ mode: 'string' }).notNull(),

    // Fri–Thu week index e.g. "2026-W24" — derived from transactionDate, not from recordedAt.
    // An order backdated to last Thursday belongs in last week's period; deriving it from the
    // insert time would put the whole point of backdating out of reach.
    settlementPeriod: varchar().notNull(),

    // write-through cache of the latest status row — recomputable from whole_buy_statuses
    currentStatus: wholeBuyStatusEnum().notNull().default('CREATED'),

    // recordedAt + the configured edit window. While CREATED and before this instant the
    // transaction can still be edited; past it the auto-confirm job moves it to CONFIRMED.
    confirmDueAt: timestamp({ withTimezone: true }).notNull(),

    notes: text(),

    recordedBy: varchar().notNull(),
    // when the row reached the database — server-written, never caller-supplied. See
    // transactionDate above for why both exist.
    recordedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export type CreateWholeBuyStatus = typeof wholeBuyStatuses.$inferInsert;
export type WholeBuyStatusShape = typeof wholeBuyStatuses.$inferSelect;
