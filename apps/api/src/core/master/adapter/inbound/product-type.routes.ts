import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appRuntime } from "../../../../infrastructure/runtime.js";
import { handleExit } from "../../../../infrastructure/http/errors.js";
import { ProductTypeUseCase } from "../../application/product-type.usecase.js";
import { ProductTypeErrorTag } from "../../port/product-type.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";

const useCase = new ProductTypeUseCase(appRuntime);

const domainErrors: Record<ProductTypeErrorTag, readonly [string, ContentfulStatusCode]> = {
    ProductTypeNotFound: ["Product type not found", 404],
};

export const productTypeRouter = new Hono()
    .get("/", async (c) => {
        const result = await useCase.listProductTypes();
        return handleExit(c, result, (productTypes) => c.json({ productTypes }, 200));
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await useCase.findProductTypeById(c.req.valid("param"));
        return handleExit(c, result, (productType) => c.json({ productType }, 200), domainErrors);
    });
