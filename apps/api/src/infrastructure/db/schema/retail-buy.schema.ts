import { date, decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { factor, money, weight } from "./columns.js";
import { branches, brands, productTypes, purities } from "./master.schema.js";

/**
 * `DRAFT` is retained as a value but is unreachable: a manual write-up of a trade that already
 * happened at the counter is a fact, not a draft, so `createTransaction` lands on `CONFIRMED`.
 * Removing an enum value is a painful migration; leaving one unreachable costs nothing, and it is
 * how a POS feed (which does have a pending state) would re-enter later.
 *
 * `STOCKED` is the customer's gold put away — the one status that increments inventory, and
 * terminal, as wholesale-buy's `CHECKED` is.
 */
export const retailBuyStatusEnum = pgEnum('retail_buy_status', [
    'DRAFT',
    'CONFIRMED',
    'STOCKED',
    'CANCELLED',
])

export const retailBuyTransactions = pgTable('retail_buy_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    branchCode: varchar().notNull().references(() => branches.branchCode),

    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    /**
     * Nullable, and unread. Brand is recorded when the gold is put away, not when the trade is
     * written up, and — exactly as on the wholesale tables — it lives in the movement ledger as a
     * split across pools rather than in a column that could hold only one stamp. The column stays
     * because dropping it is a migration for no gain; nothing may depend on it being present.
     */
    brandId: varchar().references(() => brands.id),

    weightGb: weight().notNull(),
    weightGm: weight().notNull(),
    conversionFactor: factor().notNull(), // GB * factor = GM, snapshotted from unit_conversions

    pricePerGb: money().notNull(), // what the customer was paid, per gold baht
    totalAmount: money().notNull(), // weightGb * pricePerGb — gold value ONLY
    /**
     * ค่าบล็อค and the like, in THB. Deliberately **outside** `totalAmount`: keeping the total to
     * gold value is what makes it comparable against the wholesale domains, which have no fees at
     * all. Anything needing all-in cash adds the two. Null on a buy in practice — the shop does not
     * refund a fee when taking metal back — but the column is shared with retail-sell.
     */
    operationFee: money(),

    /** The business day the deal happened — picked by the operator, defaults to today, never future. */
    transactionDate: date().notNull(),
    /** Fri–Thu week label, e.g. "2026-W24". Derived server-side from `transactionDate`, never sent. */
    settlementPeriod: varchar().notNull(),

    // write-through cache of the latest status row — recomputable from retail_buy_statuses
    currentStatus: retailBuyStatusEnum().notNull().default('CONFIRMED'),

    /** How the row got here. `MANUAL` today; a POS feed will register its own value. */
    source: varchar().notNull().default('MANUAL'),
    notes: text(),

    recordedBy: varchar().notNull(), // from the JWT, never the request body
    recordedAt: timestamp({ withTimezone: true }).defaultNow().notNull(), // server clock
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
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export type CreateRetailBuyStatus = typeof retailBuyStatuses.$inferInsert;
export type RetailBuyStatusShape = typeof retailBuyStatuses.$inferSelect;
