import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appRuntime } from "../../../../infrastructure/runtime.js";
import { handleExit } from "../../../../infrastructure/http/errors.js";
import { BrandUseCase } from "../../application/brand.usecase.js";
import { BrandErrorTag } from "../../port/brand.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";

const useCase = new BrandUseCase(appRuntime);

const domainErrors: Record<BrandErrorTag, readonly [string, ContentfulStatusCode]> = {
    BrandNotFound: ["Brand not found", 404],
};

export const brandRouter = new Hono()
    .get("/", async (c) => {
        const result = await useCase.listBrands();
        return handleExit(c, result, (brands) => c.json({ brands }, 200));
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await useCase.findBrandById(c.req.valid("param"));
        return handleExit(c, result, (brand) => c.json({ brand }, 200), domainErrors);
    });
