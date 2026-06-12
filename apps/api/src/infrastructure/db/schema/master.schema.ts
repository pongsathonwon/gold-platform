import { boolean, date, decimal, integer, pgEnum, pgTable, primaryKey, uuid, varchar, } from "drizzle-orm/pg-core";



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

export const unitOfMeasureEnum = pgEnum('unit_of_measure', ['g', 'gb'])

export const purities = pgTable("purities", {
    id: varchar({ length: 4 }).primaryKey(),
    label: varchar({ length: 10 }).notNull(),
    percent: decimal({ precision: 2, scale: 2, mode: 'number' }).notNull(),
    unitOfMeasure: unitOfMeasureEnum().notNull(),
    active: boolean().default(true).notNull()
})

export type Purity = typeof purities.$inferSelect

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

export const unitConversions = pgTable('unit_conversion', {
    id: uuid().primaryKey().defaultRandom(),
    factorValue: decimal({ mode: 'number', scale: 2, precision: 4 }).notNull(),
    effectiveDate: date().defaultNow().notNull(),
    changeBy: uuid()
})

export const branches = pgTable("branches", {
    branchCode: varchar({ length: 3 }).primaryKey(),
    branchName: varchar().notNull(),
    branchShortName: varchar({ length: 10 }).notNull(),
    active: boolean().default(true).notNull()
})

export type Branch = typeof branches.$inferSelect
