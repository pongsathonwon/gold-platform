import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";
import { listPurities, findPurityById } from "../../application/purity.usecase.js";
import { PurityNotFound } from "../../port/purity.port.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { unhandledError } from "../../../../infrastructure/http/errors.js";

function toHttpError(error: unknown): [string, ContentfulStatusCode] {
    if (error instanceof PurityNotFound) return ["Purity not found", 404]
    return unhandledError(error, "master/purity")
}

export const purity = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listPurities())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    })
    .get("/:id", zValidator("param", z.object({ id: z.string().min(1) })), async (c) => {
        const result = await runEffect(findPurityById(c.req.valid("param").id))
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status)
    });
