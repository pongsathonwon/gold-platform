import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { runEffect } from "../../../infrastructure/runtime.js";
import { authMiddleware } from "../../../infrastructure/http/middleware/auth.middleware.js";
import { stockGainSchema, stockLossSchema, productSwitchSchema } from "@gold-platform/types";
import { InsufficientStockError, NoSnapshotError } from "../port/inventories.port.js";
import {
    getInventoryVolume, stockGain, stockLoss, computeSnapshots, getTodaySnapshots, productSwitch,
} from "../application/inventory.usecase.js";

function toHttpError(error: unknown): [string, number] {
    if (error instanceof InsufficientStockError) {
        return [`Insufficient stock — requested ${error.requested} GB, available ${error.available} GB`, 422]
    }
    if (error instanceof NoSnapshotError) {
        return [`Today's rate not set — compute snapshot first`, 422]
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
    .post("/snapshots/compute", async (c) => {
        const result = await runEffect(computeSnapshots())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/snapshots", async (c) => {
        const result = await runEffect(getTodaySnapshots())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .post("/product-switch", zValidator("json", productSwitchSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(productSwitch(req, currentUsername(c)))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
