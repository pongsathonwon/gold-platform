import { Hono } from "hono";
import { productTypeRouter } from "./inbound/product-type.routes.js";
import { brandRouter } from "./inbound/brand.routes.js";
import { purity } from "./inbound/purity.routes.js";
import { barSizeRouter } from "./inbound/bar-size.routes.js";
import { branchRouter } from "./inbound/branch.routes.js";
import { supplierRouter } from "./inbound/supplier.routes.js";

export const masterDataRouter = new Hono()
    .route("/product-types", productTypeRouter)
    .route("/brands", brandRouter)
    .route("/purity-grades", purity)
    .route("/bar-sizes", barSizeRouter)
    .route("/branches", branchRouter)
    .route("/suppliers", supplierRouter);
