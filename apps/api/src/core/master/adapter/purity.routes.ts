import { Hono } from "hono";
import { PurityUserCase } from "../application/purity.usecase.js";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { handleExit } from "../../../infrastructure/http/errors.js";
import { PurityErrorTag } from "../port/purity.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";

const purityUseCase = new PurityUserCase(appRuntime);

const purityDomainErrors: Record<PurityErrorTag, [string, ContentfulStatusCode]> = {
    PurityNotFound: ["Purity not found", 404],
} as const

export const purity = new Hono()
    .get("/", async (c) => {
        const result = await purityUseCase.listPurities();
        return handleExit(c, result, (purities) => c.json({ purities }, 200));
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await purityUseCase.findPurityById(c.req.valid("param"));
        return handleExit(c, result, (purity) => c.json({ ...purity }, 200), purityDomainErrors);
    });
