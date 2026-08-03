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

// the active product_type_purities row for a pairing — carries the weight input unit (kg or gb)
// and the orderable-quantity rule for it
export const findQuantityRule = (productTypeId: string, purityId: string) =>
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
        return ruleRows[0]
    })

// resolves a single caller-supplied weight (in whatever unit product_type_purities says for this
// productType/purity pairing — kg or gb) into weightGb/weightGm/conversionFactor, after validating
// it against that pairing's minQuantity/allowedValues. Composes resolveWeights() rather than
// duplicating its purity->unit logic.
export const resolveQuantity = (productTypeId: string, purityId: string, weight: number) =>
    Effect.gen(function* () {
        const rule = yield* findQuantityRule(productTypeId, purityId)

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

// same unit handling as resolveQuantity, without the orderable-quantity validation. For weights
// that were *measured* rather than ordered — a delivery that arrives 9.95 GB against a 10 GB order
// is a legitimate short delivery, not invalid input, so minQuantity/allowedValues must not apply.
export const resolveMeasuredQuantity = (productTypeId: string, purityId: string, weight: number) =>
    Effect.gen(function* () {
        const rule = yield* findQuantityRule(productTypeId, purityId)
        const gramsEquivalent = rule.inputUnit === "kg" ? weight * 1000 : weight
        return yield* resolveWeights(purityId, gramsEquivalent)
    })
