import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";
import { findBarSizeById, listBarSizes } from "../../application/bar-size.usecase.js";
import { BarSizeNotFound } from "../../port/bar-size.port.js";

function toHttpError(error: unknown): [string, number] {
    if (error instanceof BarSizeNotFound) return ["Bar size not found", 404]
    return [JSON.stringify(error), 500]
}

export const barSizeRouter = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listBarSizes())
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await runEffect(findBarSizeById(c.req.valid("param")));
        if (result.result === "success") return c.json({ data: result.data }, 200)
        const [msg, status] = toHttpError(result.error); return c.json({ error: msg }, status as any)
    });
