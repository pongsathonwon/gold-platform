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
    // the increment the weight had to land on, when the pairing defines one
    stepQuantity: number | null
    inputUnit: "kg" | "gb"
}> {}

/** The orderable-quantity rule for a pairing — the part of the row that decides validity. */
export interface QuantityRule {
    minQuantity: number
    allowedValues: number[] | null
    stepQuantity: number | null
}

/**
 * Whether a weight satisfies a pairing's quantity rule — the whole rule as a pure function.
 *
 * Lifted out of `resolveQuantity` for the same reason `divideWeight` is lifted out of
 * `resolveBrandSplit`: the rule is the part worth testing, and it should not need a database to
 * assert. `resolveQuantity` keeps the lookup and the failure construction.
 *
 * Three rules, in the order they narrow:
 *  - `allowedValues`, when set, is the whole answer — a closed list of the only weights accepted.
 *  - otherwise the weight must reach `minQuantity`,
 *  - and land on `stepQuantity` if the pairing defines one. 96.5% gold bar steps by 5 because
 *    bars come in 5/10/20/50 GB, so 7 GB is a quantity no combination of stock could satisfy.
 *
 * Fractions are never valid: every unit here is counted, not measured.
 */
export function isValidQuantity(rule: QuantityRule, weight: number): boolean {
    if (!Number.isInteger(weight)) return false
    if (rule.allowedValues) return rule.allowedValues.includes(weight)
    if (weight < rule.minQuantity) return false
    return !rule.stepQuantity || weight % rule.stepQuantity === 0
}

/**
 * One wording for the quantity rules, shared by every router that resolves a weight.
 *
 * It was duplicated in three `toHttpError` functions, none of which mentioned the step — so a
 * rejected 7 GB order would have been explained as "at least 5 GB", which it already was.
 */
export function quantityErrorMessage(error: InvalidQuantityError): string {
    const unit = error.inputUnit === "kg" ? "กก." : "บาททอง"

    if (error.allowedValues) {
        return `น้ำหนักต้องเป็น ${error.allowedValues.join(", ")} ${unit} เท่านั้น`
    }
    if (error.stepQuantity) {
        return `น้ำหนักต้องเป็นจำนวนเท่าของ ${error.stepQuantity} ${unit} และไม่น้อยกว่า ${error.minQuantity} ${unit}`
    }
    return `น้ำหนักต้องเป็นจำนวนเต็ม และไม่น้อยกว่า ${error.minQuantity} ${unit}`
}

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

        if (!isValidQuantity(rule, weight)) {
            return yield* Effect.fail(new InvalidQuantityError({
                weight,
                minQuantity: rule.minQuantity,
                allowedValues: rule.allowedValues,
                stepQuantity: rule.stepQuantity,
                inputUnit: rule.inputUnit,
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
