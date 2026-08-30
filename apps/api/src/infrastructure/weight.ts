import { Data, Effect } from "effect";
import { desc, eq, lte } from "drizzle-orm";
import { DrizzleClient, RepositoryError } from "./db/client.js";
import { purities, unitConversions } from "./db/schema/master.schema.js";
import { roundWeight, todayBusinessDate } from "@gold-platform/types";

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

        /**
         * The factor in force **today**, which is not the same as the newest row.
         *
         * This used to read every row, sort ascending and take the last — so the instant anyone
         * pre-entered a rate change with a future `effectiveDate`, every conversion in the system
         * started using it. Nothing would fail: weights would simply be computed at a factor that
         * is not yet the agreed one, on transactions already being priced and booked against it.
         *
         * Bounded by Bangkok's today rather than the server's, for the same reason every other
         * business date is. A row dated today is in force — the boundary is the start of the day,
         * so `lte` and not `lt`.
         *
         * A future-dated row is now simply invisible until its day arrives, which is what
         * `effectiveDate` promises. If *every* row is future-dated there is no factor in force and
         * `NoConversionRateError` is the honest answer rather than borrowing tomorrow's number.
         */
        const rateRows = yield* Effect.tryPromise({
            try: () => db
                .select()
                .from(unitConversions)
                .where(lte(unitConversions.effectiveDate, todayBusinessDate()))
                .orderBy(desc(unitConversions.effectiveDate))
                .limit(1)
                .execute(),
            catch: () => new RepositoryError({ message: 'cannot look up conversion rate' }),
        })
        const latestRate = rateRows.at(0)
        if (!latestRate) return yield* Effect.fail(new NoConversionRateError())
        const conversionFactor = latestRate.factorValue

        // unitOfMeasure 'g'  → caller sends grams,  gb = gm / factor
        // unitOfMeasure 'gb' → caller sends baht,   gm = gb * factor
        //
        // The derived side is rounded to the scale its column stores. The entered side is not
        // touched: it is what the operator typed, and rounding a value nobody computed would only
        // ever be a way to disagree with them. `weight / 15.244` does not terminate, so without
        // this the column and the request hold different numbers from the first transaction on.
        if (purity.unitOfMeasure === 'g') {
            return { weightGm: weight, weightGb: roundWeight(weight / conversionFactor), conversionFactor, unitOfMeasure: 'g' } satisfies ResolvedWeights
        }
        return { weightGb: weight, weightGm: roundWeight(weight * conversionFactor), conversionFactor, unitOfMeasure: 'gb' } satisfies ResolvedWeights
    })
