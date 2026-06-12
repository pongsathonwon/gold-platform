import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appRuntime } from "../../../../infrastructure/runtime.js";
import { handleExit } from "../../../../infrastructure/http/errors.js";
import { BranchUseCase } from "../../application/branch.usecase.js";
import { BranchErrorTag } from "../../port/branch.port.js";
import { ContentfulStatusCode } from "hono/utils/http-status";

const useCase = new BranchUseCase(appRuntime);

const domainErrors: Record<BranchErrorTag, readonly [string, ContentfulStatusCode]> = {
    BranchNotFound: ["Branch not found", 404],
};

export const branchRouter = new Hono()
    .get("/", async (c) => {
        const result = await useCase.listBranches();
        return handleExit(c, result, (branches) => c.json({ branches }, 200));
    })
    .get("/:id", zValidator("param", z.string().min(1)), async (c) => {
        const result = await useCase.findBranchById(c.req.valid("param"));
        return handleExit(c, result, (branch) => c.json({ branch }, 200), domainErrors);
    });
