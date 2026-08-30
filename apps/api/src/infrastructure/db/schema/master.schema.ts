import { boolean, date, decimal, integer, pgEnum, pgTable, primaryKey, timestamp, uuid, varchar, } from "drizzle-orm/pg-core";
import { factor } from "./columns.js";

export const originEnum = pgEnum('origin', ['domestic', 'foreign'])

export const productTypes = pgTable("gold_product_type", {
    id: varchar({ length: 10 }).primaryKey(),
    productType: varchar().notNull(),
    supplierTradeable: boolean().default(true).notNull(),
    active: boolean().default(true).notNull()
})

export type ProductType = typeof productTypes.$inferSelect


// what stamp on gold
export const brands = pgTable("gold_brands", {
    id: varchar({ length: 10 }).primaryKey(),
    brand: varchar().notNull(),
    nonFungible: boolean().default(false).notNull(),
    active: boolean().default(true).notNull(),
})

export type GoldBrand = typeof brands.$inferSelect

export const unitOfMeasureEnum = pgEnum('unit_of_measure_enum', ['g', 'gb'])

export const purities = pgTable("purities", {
    id: varchar({ length: 4 }).primaryKey(),
    label: varchar({ length: 10 }).notNull(),
    percent: decimal({ precision: 5, scale: 2, mode: 'number' }).notNull(),
    unitOfMeasure: unitOfMeasureEnum().notNull(),
    active: boolean().default(true).notNull()
})

export type Purity = typeof purities.$inferSelect

// which purities are valid for a given product type, and how weight is entered for that pairing
export const weightInputUnitEnum = pgEnum('weight_input_unit', ['kg', 'gb'])

export const productTypePurities = pgTable('product_type_purities', {
    productTypeId: varchar({ length: 10 }).notNull().references(() => productTypes.id),
    purityId: varchar({ length: 4 }).notNull().references(() => purities.id),
    inputUnit: weightInputUnitEnum().notNull(),
    minQuantity: integer().notNull(),
    allowedValues: integer().array(), // null = free integer >= minQuantity; set = closed list (e.g. kg bar sizes)
    /**
     * The increment an orderable quantity must land on, when the valid weights are a regular
     * series rather than a short list. Null means any whole number at or above `minQuantity`.
     *
     * 96.5% gold bar is the case this exists for: bars come in 5, 10, 20 and 50 GB, so any real
     * quantity is a sum of those and therefore a multiple of 5. `allowedValues` cannot express
     * that — the series does not end — and hard-coding "96.5 means multiples of five" in the
     * validator would put a fact about bar stock into code, where the other two quantity rules
     * are already data.
     */
    stepQuantity: integer(),
    active: boolean().default(true).notNull(),
}, (table) => [
    primaryKey({ columns: [table.productTypeId, table.purityId] })
])

export type ProductTypePurity = typeof productTypePurities.$inferSelect

export const barSizes = pgTable('bar_sizes', {
    id: varchar({ length: 3 }).primaryKey(),
    weight: integer().notNull(),
    active: boolean().default(true).notNull()
})

export type BarSize = typeof barSizes.$inferSelect

export const suppliers = pgTable('suppliers', {
    id: uuid().primaryKey().defaultRandom(),
    supplierName: varchar({ length: 100 }).notNull(),
    brandLock: boolean().notNull(),
    active: boolean().default(true).notNull()
})

export type Supplier = typeof suppliers.$inferSelect

export const supplierProductTypes = pgTable('supplier_product_types', {
    supplierId: uuid().references(() => suppliers.id),
    productTypeId: varchar({ length: 10 }).references(() => productTypes.id),
}, (table) => [
    primaryKey({ columns: [table.supplierId, table.productTypeId] })
])
// added as utility for supplier and brand auto pick
export const supplierBrands = pgTable('suppler_brands', {
    supplierId: uuid().references(() => suppliers.id),
    brandId: varchar({ length: 10 }).references(() => brands.id),
}, (table) => [
    primaryKey({ columns: [table.supplierId, table.brandId] })
])
// TODO: should create a drizzle relation for query

export const unitConversions = pgTable('unit_conversion', {
    id: uuid().primaryKey().defaultRandom(),
    // The same helper the transaction tables snapshot this into, so the copy cannot be declared
    // differently from the original.
    factorValue: factor().notNull(),
    effectiveDate: date().defaultNow().notNull(),
    changeBy: uuid()
})

export const branches = pgTable("branches", {
    branchCode: varchar({ length: 3 }).primaryKey(),
    branchName: varchar().notNull(),
    branchShortName: varchar({ length: 10 }).notNull(),
    /**
     * Operational, and reversible: a branch that is not trading right now. Distinct from
     * `deletedAt`, which is removal from the system — a closed branch still has to resolve its
     * name on every transaction it ever recorded.
     */
    active: boolean().default(true).notNull(),
    /** When the row reached the database. Server clock, never caller-supplied. */
    insertedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    /** Soft-delete tombstone; null = live. Hard deletion is impossible once transactions FK this. */
    deletedAt: timestamp({ withTimezone: true }),
})

export type Branch = typeof branches.$inferSelect
