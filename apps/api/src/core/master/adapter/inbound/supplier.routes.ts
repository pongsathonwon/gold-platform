import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appRuntime } from "../../../../infrastructure/runtime.js";
import { handleExit } from "../../../../infrastructure/http/errors.js";
import { SupplierUseCase } from "../../application/supplier.usecase.js";
import { SupplierErrorTag } from "../../port/supplier.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";

const useCase = new SupplierUseCase(appRuntime);

const domainErrors: Record<SupplierErrorTag, readonly [string, ContentfulStatusCode]> = {
    SupplierNotFound: ["Supplier not found", 404],
};

export const supplierRouter = new Hono()
    .get("/", async (c) => {
        const result = await useCase.listSuppliers();
        return handleExit(c, result, (suppliers) => c.json({ suppliers }, 200));
    })
    .get("/:id", zValidator("param", z.string().uuid()), async (c) => {
        const result = await useCase.findSupplierById(c.req.valid("param"));
        return handleExit(c, result, (supplier) => c.json({ supplier }, 200), domainErrors);
    })
    .get("/:id/product-types", zValidator("param", z.string().uuid()), async (c) => {
        const result = await useCase.findSupplierProductTypes(c.req.valid("param"));
        return handleExit(c, result, (productTypes) => c.json({ productTypes }, 200), domainErrors);
    });
