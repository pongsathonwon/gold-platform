import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";
import { listSuppliers, findSupplierById, findSupplierProductTypes, findSupplierBrands } from "../../application/supplier.usecase.js";
import { SupplierNotFound } from "../../port/supplier.port.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { unhandledError } from "../../../../infrastructure/http/errors.js";

function toHttpError(error: unknown): [string, ContentfulStatusCode] {
    if (error instanceof SupplierNotFound) return ["Supplier not found", 404]
    return unhandledError(error, "master/supplier")
}

export const supplierRouter = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listSuppliers())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    .get("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
        const result = await runEffect(findSupplierById(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    .get("/:id/product-types", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
        const result = await runEffect(findSupplierProductTypes(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    // the brands this supplier ships — drives the brand-split fields on the transitions that move
    // stock. A brandLock supplier returns exactly one, and the operator enters nothing.
    .get("/:id/brands", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
        const result = await runEffect(findSupplierBrands(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    });
