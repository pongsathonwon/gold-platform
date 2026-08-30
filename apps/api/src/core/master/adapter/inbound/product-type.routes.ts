import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";
import { listProductTypes, findProductTypeById, findProductTypePurities } from "../../application/product-type.usecase.js";
import { ProductTypeNotFound } from "../../port/product-type.port.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { unhandledError } from "../../../../infrastructure/http/errors.js";

function toHttpError(error: unknown): [string, ContentfulStatusCode] {
    if (error instanceof ProductTypeNotFound) return ["Product type not found", 404]
    return unhandledError(error, "master/product-type")
}

export const productTypeRouter = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listProductTypes())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    .get("/:id", zValidator("param", z.object({ id: z.string().min(1) })), async (c) => {
        const result = await runEffect(findProductTypeById(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    .get("/:id/purities", zValidator("param", z.object({ id: z.string().min(1) })), async (c) => {
        const result = await runEffect(findProductTypePurities(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    });
