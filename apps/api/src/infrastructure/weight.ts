import { Data, Effect } from "effect";
import { eq } from "drizzle-orm";
import { DrizzleClient, RepositoryError } from "./db/client.js";
import { purities, unitConversions } from "./db/schema/master.schema.js";

export class PurityNotFoundError extends Data.TaggedError("PurityNotFoundError")<{ purityId: string }> {}
export class NoConversionRateError extends Data.TaggedError("NoConversionRateError") {}

export interface ResolvedWeights {
    weightGb: number
    weightGm: number
    conversionFactor: number
    // the resolved purity's unit — 'g' is 99.9%, 'gb' is 96.5%. Callers that price per purity
    // (wholesale-buy) key off this instead of re-querying the purity row.
    unitOfMeasure: 'g' | 'gb'
}

export const resolveWeights = (purityId: string, weight: number) =>
    Effect.gen(function* () {
        const db = yield* DrizzleClient

        const purityRows = yield* Effect.tryPromise({
            try: () => db.select().from(purities).where(eq(purities.id, purityId)).execute(),
            catch: () => new RepositoryError({ message: `cannot look up purity ${purityId}` }),
        })
        if (purityRows.length !== 1) return yield* Effect.fail(new PurityNotFoundError({ purityId }))
        const purity = purityRows[0]

        const rateRows = yield* Effect.tryPromise({
            try: () => db.select().from(unitConversions).orderBy(unitConversions.effectiveDate).execute(),
            catch: () => new RepositoryError({ message: 'cannot look up conversion rate' }),
        })
        const latestRate = rateRows.at(-1)
        if (!latestRate) return yield* Effect.fail(new NoConversionRateError())
        const conversionFactor = latestRate.factorValue

        // unitOfMeasure 'g'  → caller sends grams,  gb = gm / factor
        // unitOfMeasure 'gb' → caller sends baht,   gm = gb * factor
        if (purity.unitOfMeasure === 'g') {
            return { weightGm: weight, weightGb: weight / conversionFactor, conversionFactor, unitOfMeasure: 'g' } satisfies ResolvedWeights
        }
        return { weightGb: weight, weightGm: weight * conversionFactor, conversionFactor, unitOfMeasure: 'gb' } satisfies ResolvedWeights
    })
