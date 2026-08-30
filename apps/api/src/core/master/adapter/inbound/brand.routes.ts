import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";
import { listBrands, findBrandById } from "../../application/brand.usecase.js";
import { BrandNotFound } from "../../port/brand.port.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { unhandledError } from "../../../../infrastructure/http/errors.js";

function toHttpError(error: unknown): [string, ContentfulStatusCode] {
    if (error instanceof BrandNotFound) return ["Brand not found", 404]
    return unhandledError(error, "master/brand")
}

export const brandRouter = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listBrands())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    .get("/:id", zValidator("param", z.object({ id: z.string().min(1) })), async (c) => {
        const result = await runEffect(findBrandById(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    });
