import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../infrastructure/runtime.js";
import { createTransaction, advanceStatus, getTransaction, listTransactions } from "../application/wholesale-sell.usecase.js";

const wholeSellStatusValues = ['CONFIRMED', 'SHIPPED', 'SETTLED', 'CANCELLED'] as const

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
    toStatus: z.enum(wholeSellStatusValues),
    note: z.string().optional(),
    updatedBy: z.string().min(1),
})

const listQuerySchema = z.object({
    currentStatus: z.enum(['DRAFT', ...wholeSellStatusValues]).optional(),
    settlementPeriod: z.string().optional(),
})

export const wholesaleSellRoutes = new Hono()
    .post("/", zValidator("json", createTransactionSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(createTransaction(req))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        return c.json({ error: result.error }, 500)
    })
    .get("/", zValidator("query", listQuerySchema), async (c) => {
        const req = c.req.valid("query")
        const result = await runEffect(listTransactions(req))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    })
    .get("/:id", async (c) => {
        const result = await runEffect(getTransaction(c.req.param("id")))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    })
    .post("/:id/status", zValidator("json", advanceStatusSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(advanceStatus({ transactionId: c.req.param("id"), ...req }))
        if (result.result === "success") return c.json({}, 200)
        return c.json({ error: result.error }, 500)
    })
