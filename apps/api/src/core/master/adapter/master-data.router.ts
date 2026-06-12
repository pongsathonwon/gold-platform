import { Hono } from "hono";
import { productTypeRouter } from "./product-type.routes.js";
import { brandRouter } from "./brand.routes.js";
import { purity } from "./purity.routes.js";
import { barSizeRouter } from "./bar-size.routes.js";
import { branchRouter } from "./branch.routes.js";
import { supplierRouter } from "./supplier.routes.js";

export const masterDataRouter = new Hono()
    .route("/product-types", productTypeRouter)
    .route("/brands", brandRouter)
    .route("/purity-grades", purity)
    .route("/bar-sizes", barSizeRouter)
    .route("/branches", branchRouter)
    .route("/suppliers", supplierRouter);
