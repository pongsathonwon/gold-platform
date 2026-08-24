import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
    advanceRetailSellStatusSchema, businessDaySchema, createRetailSellSchema, retailSellStatusSchema,
} from "@gold-platform/types";
import { runEffect } from "../../../infrastructure/runtime.js";
import { authMiddleware, currentUsername } from "../../../infrastructure/http/middleware/auth.middleware.js";
import { createTransaction, advanceStatus, getTransaction, listTransactions } from "../application/retail-sell.usecase.js";
import { InvalidTransitionError, NoteRequiredError, TransactionNotFoundError } from "../port/retail-sell.port.js";
import { NoConversionRateError, PurityNotFoundError } from "../../../infrastructure/weight.js";
import { InvalidQuantityError, ProductTypePurityNotFoundError, quantityErrorMessage } from "../../../infrastructure/quantity.js";
import { RetailSellStatus } from "../../../infrastructure/db/schema/retail-sell.schema.js";

function toHttpError(error: unknown): [string, number] {
    if (error instanceof TransactionNotFoundError) return [`transaction ${error.id} not found`, 404]
    if (error instanceof InvalidTransitionError) return [`invalid transition from ${error.from} to ${error.to}`, 422]
    if (error instanceof NoteRequiredError) return [`a note is required when moving to ${error.status}`, 422]
    if (error instanceof ProductTypePurityNotFoundError) return [`ไม่พบการจับคู่ประเภทสินค้ากับความบริสุทธิ์`, 422]
    if (error instanceof InvalidQuantityError) return [quantityErrorMessage(error), 422]
    if (error instanceof PurityNotFoundError) return [`purity ${error.purityId} not found`, 422]
    if (error instanceof NoConversionRateError) return [`no conversion rate available`, 503]
    return [JSON.stringify(error), 500]
}

const listQuerySchema = z.object({
    currentStatus: retailSellStatusSchema.optional(),
    settlementPeriod: z.string().optional(),
    branchCode: z.string().optional(),
    // business days, both ends inclusive — the window an operator actually browses in
    from: businessDaySchema.optional(),
    to: businessDaySchema.optional(),
})

/**
 * Every route requires an authenticated caller, and the actor is taken from the verified token.
 *
 * `recordedBy` / `updatedBy` used to arrive in the request body, which meant any authenticated user
 * could attribute a trade to a colleague. They are no longer part of the wire contract at all.
 *
 * No `requireRole`: recording the day's counter trades is ordinary operator work. The ADMIN gate
 * exists for figures nobody else asked for — the manual inventory adjustments — and retail has a
 * customer on the other side of it.
 */
export const retailSellRoutes = new Hono()
    .use(authMiddleware)
    .post("/", zValidator("json", createRetailSellSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(createTransaction({ ...req, recordedBy: currentUsername(c) }))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/", zValidator("query", listQuerySchema), async (c) => {
        const req = c.req.valid("query")
        const result = await runEffect(listTransactions({ ...req, currentStatus: req.currentStatus as RetailSellStatus | undefined }))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/:id", async (c) => {
        const result = await runEffect(getTransaction(c.req.param("id")))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/:id/status", zValidator("json", advanceRetailSellStatusSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(advanceStatus({
            transactionId: c.req.param("id"),
            ...req,
            toStatus: req.toStatus as RetailSellStatus,
            updatedBy: currentUsername(c),
        }))
        // returns the status actually reached, so the UI can say so rather than assume
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
