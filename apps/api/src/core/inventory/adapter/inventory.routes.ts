import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { runEffect } from "../../../infrastructure/runtime.js";
import {
    authMiddleware, currentUsername, requireRole,
} from "../../../infrastructure/http/middleware/auth.middleware.js";
import { businessDaySchema, stockGainSchema, stockLossSchema, productSwitchSchema } from "@gold-platform/types";
import { InsufficientStockError, ProtectedOriginError } from "../port/inventories.port.js";
import { InvalidQuantityError, ProductTypePurityNotFoundError, quantityErrorMessage } from "../../../infrastructure/quantity.js";
import { PurityNotFoundError, NoConversionRateError } from "../../../infrastructure/weight.js";
import {
    getInventoryVolume, stockGain, stockLoss, productSwitch, getInventoryMovements,
} from "../application/inventory.usecase.js";

const movementsQuerySchema = z.object({
    purityId: z.string().optional(),
    brandId: z.string().optional(),
    origin: z.enum(['domestic', 'foreign']).optional(),
    productTypeId: z.string().optional(),
    referenceType: z.string().optional(),
    // Business days (`YYYY-MM-DD`), not instants: the window is over each movement's
    // `movementDate`, and both ends are inclusive. Callers used to send ISO datetimes and had to
    // remember an end-of-day time on `to` or lose the last day's movements.
    from: businessDaySchema.optional(),
    to: businessDaySchema.optional(),
})

function toHttpError(error: unknown): [string, number] {
    if (error instanceof ProtectedOriginError) {
        return ["ปรับสต๊อกด้วยตนเองกับทองในไม่ได้ — ทองในสร้างจากการหลอมและตัดออกด้วยการแปรสภาพเท่านั้น", 422]
    }
    if (error instanceof InsufficientStockError) {
        return [`Insufficient stock — requested ${error.requested} GB, available ${error.available} GB`, 422]
    }
    if (error instanceof ProductTypePurityNotFoundError) {
        return [`Purity ${error.purityId} is not valid for product type ${error.productTypeId}`, 422]
    }
    if (error instanceof InvalidQuantityError) {
        return [quantityErrorMessage(error), 422]
    }
    if (error instanceof PurityNotFoundError) {
        return [`Purity ${error.purityId} not found`, 422]
    }
    if (error instanceof NoConversionRateError) {
        return [`No conversion rate available`, 503]
    }
    return [JSON.stringify(error), 500]
}

/**
 * Reading stock is part of the trading day; adjusting it is not.
 *
 * The three write routes below are the only paths in the system that move gold on the books with
 * no counterparty transaction behind them — a figure is corrected because someone says it should
 * be. Their tables carry `auditedBy` for exactly that reason, so the operation is restricted to
 * the role that can be held to it. Everything a counterparty *does* drive stays open to any
 * authenticated operator, because that is the job.
 */
const adjustments = requireRole("ADMIN")

export const inventoriesRoutes = new Hono()
    .use(authMiddleware)
    .get("/volume", async (c) => {
        const result = await runEffect(getInventoryVolume())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/gain", adjustments, zValidator("json", stockGainSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(stockGain(req, currentUsername(c)))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/loss", adjustments, zValidator("json", stockLossSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(stockLoss(req, currentUsername(c)))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/movements", zValidator("query", movementsQuerySchema), async (c) => {
        const req = c.req.valid("query")
        const result = await runEffect(getInventoryMovements(req))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/product-switch", adjustments, zValidator("json", productSwitchSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(productSwitch(req, currentUsername(c)))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
