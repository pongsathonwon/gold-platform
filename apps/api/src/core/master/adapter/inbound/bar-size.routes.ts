import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runEffect } from "../../../../infrastructure/runtime.js";

import { BarSizeErrorTag } from "../../port/bar-size.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { findBarSizeById, listBarSizes } from "../../application/bar-size.usecase.js";


const domainErrors: Record<BarSizeErrorTag, readonly [string, ContentfulStatusCode]> = {
    BarSizeNotFound: ["Bar size not found", 404],
};

export const barSizeRouter = new Hono()
    .get("/", async (c) => {
        const result = await runEffect(listBarSizes())
        if (result.result === 'success') return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await runEffect(findBarSizeById(c.req.valid("param")));
        if (result.result === 'success') return c.json({ data: result.data }, 200)
        return c.json({ error: result.error }, 500)
    });
