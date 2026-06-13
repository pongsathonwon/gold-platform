import { decimal, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { inventoryLots } from "./inventory.schema.js";
import { branches } from "./master.schema.js";

export const fulfillmentStatusEnum = pgEnum('fulfillment_status', ['pending', 'in_transit', 'completed', 'rejected'])

// transfer out to branch
export const fulfillments = pgTable('fulfillments', {
    id: uuid().primaryKey(),
    branchCode: varchar().notNull().references(() => branches.branchCode),
    status: fulfillmentStatusEnum().notNull().default('pending'),
    createdAt: timestamp().notNull().defaultNow(),
    createdBy: varchar().notNull(),
    // lot movements are fired on status transitions:
    //   pending → in_transit:  movement -weightGb per lot (FIFO picked)
    //   in_transit → rejected: movement +weightGb per lot (reversal)
    //   in_transit → completed: no movement, already decremented
})

// FIFO-picked lot slices for this fulfillment
export const fulfillmentItems = pgTable('fulfillment_items', {
    id: uuid().primaryKey(),
    fulfillmentId: uuid().notNull().references(() => fulfillments.id),
    lotId: uuid().notNull().references(() => inventoryLots.id),
    weightGb: decimal({ mode: 'number' }).notNull(),
    weightGm: decimal({ mode: 'number' }).notNull(),
    conversionFactor: decimal({ mode: 'number' }).notNull(),
    costDelta: decimal({ mode: 'number' }).notNull(),
})

export type CreateFulfillment = typeof fulfillments.$inferInsert;
export type FulfillmentShape = typeof fulfillments.$inferSelect;
export type CreateFulfillmentItem = typeof fulfillmentItems.$inferInsert;
export type FulfillmentItemShape = typeof fulfillmentItems.$inferSelect;
