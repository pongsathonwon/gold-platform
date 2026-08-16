import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";
import { listSuppliers, findSupplierById, findSupplierProductTypes, findSupplierBrands } from "../../application/supplier.usecase.js";
import { SupplierNotFound } from "../../port/supplier.port.js";

function toHttpError(error: unknown): [string, number] {
    if (error instanceof SupplierNotFound) return ["Supplier not found", 404]
    return [JSON.stringify(error), 500]
}

export const supplierRouter = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listSuppliers())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/:id", zValidator("param", z.string().uuid()), async (c) => {
        const result = await runEffect(findSupplierById(c.req.valid("param")))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/:id/product-types", zValidator("param", z.string().uuid()), async (c) => {
        const result = await runEffect(findSupplierProductTypes(c.req.valid("param")))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    // the brands this supplier ships — drives the brand-split fields on the transitions that move
    // stock. A brandLock supplier returns exactly one, and the operator enters nothing.
    .get("/:id/brands", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
        const result = await runEffect(findSupplierBrands(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    });
