import { Hono } from "hono";
import { Inventories } from "../application/inventory.usecase.js";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { Exit } from "effect";
import { zValidator } from "@hono/zod-validator";
import { adjustLotSchema } from "@gold-platform/types";

const usecase = new Inventories(appRuntime);

export const inventoriesRoutes = new Hono()
    .get('/', async (c) => {
        const result = await usecase.listLot({});
        if (Exit.isSuccess(result)) return c.json({ data: result.value }, 200)
        return c.json({ error: 'not implemented' }, 502)
    })
    .post('/', zValidator('json', adjustLotSchema), async (c) => {
        const req = c.req.valid('json')
        const result = await usecase.adjustLot(req);
        if (Exit.isSuccess(result)) return c.json({ data: result.value }, 200)
        return c.json({ error: 'not implemented' }, 502)
    })

    ; 