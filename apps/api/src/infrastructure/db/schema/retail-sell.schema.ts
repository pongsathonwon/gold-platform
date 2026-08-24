import { date, decimal, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { branches, brands, productTypes, purities } from "./master.schema.js";

/**
 * `DRAFT` and `SHIPPED` are retained as values but are unreachable through `RETAIL_SELL_TRANSITIONS`.
 * A manual write-up lands on `CONFIRMED`, and shipping — along with the inventory decrement that
 * used to hang off it — is deferred: retail moves no stock today. Both come back by adding the
 * transition, with no migration.
 */
export const retailSellStatusEnum = pgEnum('retail_sell_status', [
    'DRAFT',
    'CONFIRMED',
    'SHIPPED',
    'CANCELLED',
])

export const retailSellTransactions = pgTable('retail_sell_transactions', {
    id: uuid().primaryKey().defaultRandom(),

    branchCode: varchar().notNull().references(() => branches.branchCode),

    purityId: varchar().notNull().references(() => purities.id),
    productTypeId: varchar().notNull().references(() => productTypes.id),
    /**
     * Nullable, and unread. Retail moves no stock — inventory is adjusted manually — so there is no
     * pool for a brand to key. It stays on the table because the metal does carry a stamp and a
     * later inventory coupling would want it; nothing today may depend on it being present.
     */
    brandId: varchar().references(() => brands.id),

    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(), // GB * factor = GM, snapshotted from unit_conversions

    pricePerGb: decimal({ mode: 'number' }).notNull(), // what the customer was charged, per gold baht
    totalAmount: decimal({ mode: 'number' }).notNull(), // weightGb * pricePerGb — gold value ONLY
    /**
     * ค่าบล็อค on ทองแผ่น, in THB. Deliberately **outside** `totalAmount`: keeping the total to gold
     * value is what makes it comparable against the wholesale domains, which have no fees at all,
     * and what keeps the price-per-gold-baht average from reading a fee as spread. Anything needing
     * all-in cash adds the two.
     */
    operationFee: decimal({ mode: 'number' }),

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
    recordedAt: timestamp().defaultNow().notNull(), // server clock
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
    createdAt: timestamp().defaultNow().notNull(),
})

export type CreateRetailSellStatus = typeof retailSellStatuses.$inferInsert;
export type RetailSellStatusShape = typeof retailSellStatuses.$inferSelect;
