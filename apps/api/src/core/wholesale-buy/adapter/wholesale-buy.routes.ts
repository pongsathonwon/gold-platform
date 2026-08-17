import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
    advanceWholeBuyStatusSchema, businessDaySchema, createWholeBuySchema,
    receiveStockWholeBuySchema, updateWholeBuySchema, wholeBuyStatusSchema,
} from "@gold-platform/types";
import { runEffect } from "../../../infrastructure/runtime.js";
import { authMiddleware } from "../../../infrastructure/http/middleware/auth.middleware.js";
import {
    advanceStatus, confirmAllCreated, createTransaction, getTransaction,
    listTransactions, receiveAndStock, updateTransaction,
} from "../application/wholesale-buy.usecase.js";
import {
    InvalidTransitionError, NotEditableError, NoteRequiredError,
    ReturnReasonRequiredError, type ReturnReason, TransactionNotFoundError,
} from "../port/wholesale-buy.port.js";
import { InvalidQuantityError, ProductTypePurityNotFoundError } from "../../../infrastructure/quantity.js";
import { brandSplitHttpError } from "../../../infrastructure/brand-split.js";
import { NoConversionRateError, PurityNotFoundError } from "../../../infrastructure/weight.js";
import { InsufficientStockError } from "../../inventory/port/inventories.port.js";
import type { WholeBuyStatus } from "../../../infrastructure/db/schema/wholesale-buy.schema.js";

function toHttpError(error: unknown): [string, number] {
    // the brand-split rejections are shared with wholesale-sell — one wording for both domains
    const brandSplitError = brandSplitHttpError(error)
    if (brandSplitError) return brandSplitError
    if (error instanceof TransactionNotFoundError) return [`transaction ${error.id} not found`, 404]
    if (error instanceof InvalidTransitionError) return [`invalid transition from ${error.from} to ${error.to}`, 422]
    if (error instanceof NoteRequiredError) return [`a note is required when moving to ${error.status}`, 422]
    if (error instanceof ReturnReasonRequiredError) return [`a return reason is required when sending a shipment back`, 422]
    if (error instanceof NotEditableError) {
        return [`transaction ${error.id} is no longer editable — it is already ${error.currentStatus}`, 422]
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
    currentStatus: wholeBuyStatusSchema.optional(),
    settlementPeriod: z.string().optional(),
    supplierId: z.string().uuid().optional(),
    // Business days (`YYYY-MM-DD`), not instants: the window is over each deal's transactionDate
    // and both ends are inclusive, so a caller never has to remember an end-of-day time on `to`.
    // Shape-only, like the movements window — a report range may legitimately reach forward.
    from: businessDaySchema.optional(),
    to: businessDaySchema.optional(),
})

export const wholesaleBuyRoutes = new Hono()
    .use(authMiddleware)
    .post("/", zValidator("json", createWholeBuySchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(createTransaction({ ...req, recordedBy: currentUsername(c) }))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/", zValidator("query", listQuerySchema), async (c) => {
        const req = c.req.valid("query")
        const result = await runEffect(listTransactions({ ...req, currentStatus: req.currentStatus as WholeBuyStatus | undefined }))
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
    .patch("/:id", zValidator("json", updateWholeBuySchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(updateTransaction({
            transactionId: c.req.param("id"), ...req, updatedBy: currentUsername(c),
        }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/:id/status", zValidator("json", advanceWholeBuyStatusSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(advanceStatus({
            transactionId: c.req.param("id"),
            ...req,
            toStatus: req.toStatus as WholeBuyStatus,
            returnReason: req.returnReason as ReturnReason | undefined,
            updatedBy: currentUsername(c),
        }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    // receive + stock as one operator action; both status entries are still logged. No weight —
    // a delivery that did not match its document was refused at the door and never gets here.
    .post("/:id/receive-stock", zValidator("json", receiveStockWholeBuySchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(receiveAndStock({
            transactionId: c.req.param("id"), ...req, updatedBy: currentUsername(c),
        }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
