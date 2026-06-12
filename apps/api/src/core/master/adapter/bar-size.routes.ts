import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { handleExit } from "../../../infrastructure/http/errors.js";
import { BarSizeUseCase } from "../application/bar-size.usecase.js";
import { BarSizeErrorTag } from "../port/bar-size.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";

const useCase = new BarSizeUseCase(appRuntime);

const domainErrors: Record<BarSizeErrorTag, readonly [string, ContentfulStatusCode]> = {
    BarSizeNotFound: ["Bar size not found", 404],
};

export const barSizeRouter = new Hono()
    .get("/", async (c) => {
        const result = await useCase.listBarSizes();
        return handleExit(c, result, (barSizes) => c.json({ barSizes }, 200));
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await useCase.findBarSizeById(c.req.valid("param"));
        return handleExit(c, result, (barSize) => c.json({ barSize }, 200), domainErrors);
    });
