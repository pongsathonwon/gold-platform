import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../infrastructure/runtime.js";
import { createTransaction, advanceStatus, getTransaction, listTransactions } from "../application/wholesale-buy.usecase.js";
import { TransactionNotFoundError, InvalidTransitionError } from "../port/wholesale-buy.port.js";

function toHttpError(error: unknown): [string, number] {
    if (error instanceof TransactionNotFoundError) return [`transaction ${error.id} not found`, 404]
    if (error instanceof InvalidTransitionError) return [`invalid transition from ${error.from} to ${error.to}`, 422]
    return [JSON.stringify(error), 500]
}

const wholeBuyStatusValues = ['CONFIRMED', 'RECEIVED', 'SETTLED', 'CANCELLED'] as const

const createTransactionSchema = z.object({
    supplierId: z.string().uuid(),
    purityId: z.string(),
    brandId: z.string(),
    productTypeId: z.string(),
    weightGb: z.number().positive(),
    weightGm: z.number().positive(),
    conversionFactor: z.number().positive(),
    pricePerGb: z.number().positive(),
    settlementPeriod: z.string().min(1),
    recordedBy: z.string().min(1),
})

const advanceStatusSchema = z.object({
    toStatus: z.enum(wholeBuyStatusValues),
    note: z.string().optional(),
    updatedBy: z.string().min(1),
})

const listQuerySchema = z.object({
    currentStatus: z.enum(['DRAFT', ...wholeBuyStatusValues]).optional(),
    settlementPeriod: z.string().optional(),
})

export const wholesaleBuyRoutes = new Hono()
    .post("/", zValidator("json", createTransactionSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(createTransaction(req))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/", zValidator("query", listQuerySchema), async (c) => {
        const req = c.req.valid("query")
        const result = await runEffect(listTransactions(req))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/:id", async (c) => {
        const result = await runEffect(getTransaction(c.req.param("id")))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/:id/status", zValidator("json", advanceStatusSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(advanceStatus({ transactionId: c.req.param("id"), ...req }))
        if (result.result === "success") return c.json({}, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
