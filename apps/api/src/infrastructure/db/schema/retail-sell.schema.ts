import { date, decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { factor, money, weight } from "./columns.js";
import { branches, brands, productTypes, purities } from "./master.schema.js";

/**
 * `DRAFT` and `SHIPPED` are retained as values but are unreachable through `RETAIL_SELL_TRANSITIONS`.
 * A manual write-up lands on `CONFIRMED`; `PACKED` is the gold pulled from the vault for the
 * customer — the one status that decrements inventory, the same edge wholesale-sell counts — and
 * is the end of the line until the hand-over states are built. `SHIPPED` will follow it then, with
 * no migration.
 */
export const retailSellStatusEnum = pgEnum('retail_sell_status', [
    'DRAFT',
    'CONFIRMED',
    'PACKED',
    'SHIPPED',
    'CANCELLED',
])

export const retailSellTransactions = pgTable('retail_sell_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    branchCode: varchar().notNull().references(() => branches.branchCode),

    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    /**
     * Nullable, and unread. Brand is recorded when the gold is pulled from the vault, not when the
     * sale is written up, and — exactly as on the wholesale tables — it lives in the movement ledger
     * as a split across pools rather than in a column that could hold only one stamp. The column
     * stays because dropping it is a migration for no gain; nothing may depend on it being present.
     */
    brandId: varchar().references(() => brands.id),

    weightGb: weight().notNull(),
    weightGm: weight().notNull(),
    conversionFactor: factor().notNull(), // GB * factor = GM, snapshotted from unit_conversions

    pricePerGb: money().notNull(), // what the customer was charged, per gold baht
    totalAmount: money().notNull(), // weightGb * pricePerGb — gold value ONLY
    /**
     * ค่าบล็อค on ทองแผ่น, in THB. Deliberately **outside** `totalAmount`: keeping the total to gold
     * value is what makes it comparable against the wholesale domains, which have no fees at all,
     * and what keeps the price-per-gold-baht average from reading a fee as spread. Anything needing
     * all-in cash adds the two.
     */
    operationFee: money(),

    /** The business day the deal happened — picked by the operator, defaults to today, never future. */
    transactionDate: date().notNull(),
    /** Fri–Thu week label, e.g. "2026-W24". Derived server-side from `transactionDate`, never sent. */
    settlementPeriod: varchar().notNull(),

    // write-through cache of the latest status row — recomputable from retail_sell_statuses
    currentStatus: retailSellStatusEnum().notNull().default('CONFIRMED'),

    /** How the row got here. `MANUAL` today; a POS feed will register its own value. */
    source: varchar().notNull().default('MANUAL'),
    notes: text(),

    recordedBy: varchar().notNull(), // from the JWT, never the request body
    recordedAt: timestamp({ withTimezone: true }).defaultNow().notNull(), // server clock
})

export type CreateRetailSellTransaction = typeof retailSellTransactions.$inferInsert;
export type RetailSellTransactionShape = typeof retailSellTransactions.$inferSelect;
export type RetailSellStatus = RetailSellTransactionShape['currentStatus'];

// append-only status log — never updated or deleted
export const retailSellStatuses = pgTable('retail_sell_statuses', {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid().notNull().references(() => retailSellTransactions.id),

    status: retailSellStatusEnum().notNull(),
    note: text(), // required when CANCELLED, optional otherwise

    createdBy: varchar().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export type CreateRetailSellStatus = typeof retailSellStatuses.$inferInsert;
export type RetailSellStatusShape = typeof retailSellStatuses.$inferSelect;
