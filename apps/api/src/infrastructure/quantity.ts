import { Data, Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { DrizzleClient, RepositoryError } from "./db/client.js";
import { productTypePurities } from "./db/schema/master.schema.js";
import { resolveWeights } from "./weight.js";

export class ProductTypePurityNotFoundError extends Data.TaggedError("ProductTypePurityNotFoundError")<{
    productTypeId: string
    purityId: string
}> {}

export class InvalidQuantityError extends Data.TaggedError("InvalidQuantityError")<{
    weight: number
    minQuantity: number
    allowedValues: number[] | null
    inputUnit: "kg" | "gb"
}> {}

// resolves a single caller-supplied weight (in whatever unit product_type_purities says for this
// productType/purity pairing — kg or gb) into weightGb/weightGm/conversionFactor, after validating
// it against that pairing's minQuantity/allowedValues. Composes resolveWeights() rather than
// duplicating its purity->unit logic.
export const resolveQuantity = (productTypeId: string, purityId: string, weight: number) =>
    Effect.gen(function* () {
        const db = yield* DrizzleClient

        const ruleRows = yield* Effect.tryPromise({
            try: () =>
                db
                    .select()
                    .from(productTypePurities)
                    .where(and(
                        eq(productTypePurities.productTypeId, productTypeId),
                        eq(productTypePurities.purityId, purityId),
                        eq(productTypePurities.active, true),
                    ))
                    .execute(),
            catch: () => new RepositoryError({ message: `cannot look up product type purity rule for ${productTypeId}/${purityId}` }),
        })
        if (ruleRows.length !== 1) return yield* Effect.fail(new ProductTypePurityNotFoundError({ productTypeId, purityId }))
        const rule = ruleRows[0]

        const withinAllowedValues = rule.allowedValues
            ? rule.allowedValues.includes(weight)
            : weight >= rule.minQuantity
        if (!Number.isInteger(weight) || !withinAllowedValues) {
            return yield* Effect.fail(new InvalidQuantityError({
                weight, minQuantity: rule.minQuantity, allowedValues: rule.allowedValues, inputUnit: rule.inputUnit,
            }))
        }

        const gramsEquivalent = rule.inputUnit === "kg" ? weight * 1000 : weight
        return yield* resolveWeights(purityId, gramsEquivalent)
    })
