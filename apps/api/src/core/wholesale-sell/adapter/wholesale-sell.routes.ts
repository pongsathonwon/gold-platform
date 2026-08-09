import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
    advanceWholeSellStatusSchema, createWholeSellSchema, packShipWholeSellSchema,
    updateWholeSellSchema, wholeSellStatusSchema,
} from "@gold-platform/types";
import { runEffect } from "../../../infrastructure/runtime.js";
import { authMiddleware } from "../../../infrastructure/http/middleware/auth.middleware.js";
import {
    advanceStatus, confirmAllCreated, createTransaction, getTransaction,
    listTransactions, packAndShip, updateTransaction,
} from "../application/wholesale-sell.usecase.js";
import {
    InvalidTransitionError, NotEditableError, NoteRequiredError,
    TransactionNotFoundError, WeightMismatchError,
} from "../port/wholesale-sell.port.js";
import { InvalidQuantityError, ProductTypePurityNotFoundError } from "../../../infrastructure/quantity.js";
import { NoConversionRateError, PurityNotFoundError } from "../../../infrastructure/weight.js";
import { InsufficientStockError } from "../../inventory/port/inventories.port.js";
import type { WholeSellStatus } from "../../../infrastructure/db/schema/wholesale-sell.schema.js";

function toHttpError(error: unknown): [string, number] {
    if (error instanceof TransactionNotFoundError) return [`transaction ${error.id} not found`, 404]
    if (error instanceof InvalidTransitionError) return [`invalid transition from ${error.from} to ${error.to}`, 422]
    if (error instanceof NoteRequiredError) return [`a note is required when moving to ${error.status}`, 422]
    if (error instanceof NotEditableError) {
        return [`transaction ${error.id} is no longer editable — it is already ${error.currentStatus}`, 422]
    }
    // an operator correction, not a business state: re-pack to the agreed weight and call again
    if (error instanceof WeightMismatchError) {
        const unit = error.unit === "kg" ? "kg" : "GB"
        return [`packed weight ${error.packed} ${unit} must equal the agreed ${error.agreed} ${unit}`, 422]
    }
    if (error instanceof ProductTypePurityNotFoundError) {
        return [`purity ${error.purityId} is not valid for product type ${error.productTypeId}`, 422]
    }
    if (error instanceof InvalidQuantityError) {
        const unit = error.inputUnit === "kg" ? "kg" : "GB"
        const msg = error.allowedValues
            ? `weight must be one of ${error.allowedValues.join(", ")} ${unit}`
            : `weight must be a whole number of at least ${error.minQuantity} ${unit}`
        return [msg, 422]
    }
    // the pool is short — the delivery never happened and the transaction stayed CONFIRMED
    if (error instanceof InsufficientStockError) {
        return [`insufficient stock — requested ${error.requested} GB, available ${error.available} GB`, 422]
    }
    if (error instanceof PurityNotFoundError) return [`purity ${error.purityId} not found`, 422]
    if (error instanceof NoConversionRateError) return [`no conversion rate available`, 503]
    return [JSON.stringify(error), 500]
}

function currentUsername(c: Context): string {
    const payload = c.get("jwtPayload") as { username: string }
    return payload.username
}

const listQuerySchema = z.object({
    currentStatus: wholeSellStatusSchema.optional(),
    settlementPeriod: z.string().optional(),
    supplierId: z.string().uuid().optional(),
})

export const wholesaleSellRoutes = new Hono()
    .use(authMiddleware)
    .post("/", zValidator("json", createWholeSellSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(createTransaction({ ...req, recordedBy: currentUsername(c) }))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/", zValidator("query", listQuerySchema), async (c) => {
        const req = c.req.valid("query")
        const result = await runEffect(listTransactions({ ...req, currentStatus: req.currentStatus as WholeSellStatus | undefined }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    // Bulk confirm — everything still CREATED. Declared before /:id so the path is never read as
    // a transaction id.
    //   ?manual=true  operator-triggered mid-day run, logged under their username
    //   (default)     the nightly scheduled run, logged as BOT-CONFIRM
    .post("/confirm-all", zValidator("query", z.object({ manual: z.enum(["true", "false"]).optional() })), async (c) => {
        const manual = c.req.valid("query").manual === "true"
        const result = await runEffect(confirmAllCreated(manual ? currentUsername(c) : undefined))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/:id", async (c) => {
        const result = await runEffect(getTransaction(c.req.param("id")))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .patch("/:id", zValidator("json", updateWholeSellSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(updateTransaction({
            transactionId: c.req.param("id"), ...req, updatedBy: currentUsername(c),
        }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/:id/status", zValidator("json", advanceWholeSellStatusSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(advanceStatus({
            transactionId: c.req.param("id"),
            ...req,
            toStatus: req.toStatus as WholeSellStatus,
            updatedBy: currentUsername(c),
        }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    // pack + ship as one operator action; both status entries are still logged, and the
    // decrement runs once on the way through PACKED
    .post("/:id/pack-ship", zValidator("json", packShipWholeSellSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(packAndShip({
            transactionId: c.req.param("id"), ...req, updatedBy: currentUsername(c),
        }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
