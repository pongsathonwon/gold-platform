import { Hono } from "hono";
import { authMiddleware } from "../../../infrastructure/http/middleware/auth.middleware.js";
import { productTypeRouter } from "./inbound/product-type.routes.js";
import { brandRouter } from "./inbound/brand.routes.js";
import { purity } from "./inbound/purity.routes.js";
import { barSizeRouter } from "./inbound/bar-size.routes.js";
import { branchRouter } from "./inbound/branch.routes.js";
import { supplierRouter } from "./inbound/supplier.routes.js";

/**
 * Reference data — brands, purities, suppliers, branches, bar sizes, product types.
 *
 * Authenticated as a whole. It is not secret in the way a transaction is, but it is the shop's
 * commercial relationships (who they buy from, which stamps those suppliers ship) and there is no
 * reason for it to be readable by anyone who finds the hostname. The router carried no middleware
 * at all before this.
 */
export const masterDataRouter = new Hono()
    .use(authMiddleware)
    .route("/product-types", productTypeRouter)
    .route("/brands", brandRouter)
    .route("/purity-grades", purity)
    .route("/bar-sizes", barSizeRouter)
    .route("/branches", branchRouter)
    .route("/suppliers", supplierRouter);
