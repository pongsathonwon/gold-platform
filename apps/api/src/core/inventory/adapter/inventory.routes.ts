import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { runEffect } from "../../../infrastructure/runtime.js";
import { authMiddleware } from "../../../infrastructure/http/middleware/auth.middleware.js";
import { stockGainSchema, stockLossSchema, productSwitchSchema } from "@gold-platform/types";
import { InsufficientStockError } from "../port/inventories.port.js";
import { InvalidQuantityError, ProductTypePurityNotFoundError } from "../../../infrastructure/quantity.js";
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
})

function toHttpError(error: unknown): [string, number] {
    if (error instanceof InsufficientStockError) {
        return [`Insufficient stock — requested ${error.requested} GB, available ${error.available} GB`, 422]
    }
    if (error instanceof ProductTypePurityNotFoundError) {
        return [`Purity ${error.purityId} is not valid for product type ${error.productTypeId}`, 422]
    }
    if (error instanceof InvalidQuantityError) {
        const unit = error.inputUnit === "kg" ? "kg" : "GB"
        const msg = error.allowedValues
            ? `Weight must be one of ${error.allowedValues.join(", ")} ${unit}`
            : `Weight must be a whole number of at least ${error.minQuantity} ${unit}`
        return [msg, 422]
    }
    if (error instanceof PurityNotFoundError) {
        return [`Purity ${error.purityId} not found`, 422]
    }
    if (error instanceof NoConversionRateError) {
        return [`No conversion rate available`, 503]
    }
    return [JSON.stringify(error), 500]
}

function currentUsername(c: Context): string {
    const payload = c.get("jwtPayload") as { username: string }
    return payload.username
}

export const inventoriesRoutes = new Hono()
    .use(authMiddleware)
    .get("/volume", async (c) => {
        const result = await runEffect(getInventoryVolume())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/gain", zValidator("json", stockGainSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(stockGain(req, currentUsername(c)))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/loss", zValidator("json", stockLossSchema), async (c) => {
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
    .post("/product-switch", zValidator("json", productSwitchSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(productSwitch(req, currentUsername(c)))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
