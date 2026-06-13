import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { runEffect } from "../../../infrastructure/runtime.js";
import { stockGainSchema, stockLossSchema } from "@gold-platform/types";
import { listLots, getInventoryVolume, stockGain, stockLoss } from "../application/inventory.usecase.js";

export const inventoriesRoutes = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listLots({}))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    })
    .get("/volume", async (c) => {
        const result = await runEffect(getInventoryVolume())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    })
    .post("/gain", zValidator("json", stockGainSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(stockGain(req))
        if (result.result === "success") return c.json({ data: result.data }, 201)
        return c.json({ error: result.error }, 500)
    })
    .post("/loss", zValidator("json", stockLossSchema), async (c) => {
        const req = c.req.valid("json")
        const result = await runEffect(stockLoss(req))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    })
