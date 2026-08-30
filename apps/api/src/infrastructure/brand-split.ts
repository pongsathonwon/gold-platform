import { Data, Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { BrandSplit, NA_BRAND } from "@gold-platform/types";
import { DrizzleClient, RepositoryError } from "./db/client.js";
import { brands, purities, supplierBrands, suppliers } from "./db/schema/master.schema.js";

/**
 * Resolving a transaction's weight into the branded pools it moves through.
 *
 * Brand is not a property of an order — it is a property of the metal, and it is only known when
 * the metal is in front of you. A supplier under `brandLock` ships one stamp and nothing else; any
 * other supplier ships a mix, and the operator records that mix at the moment stock moves.
 *
 * The invariant this file exists to hold: **a split always sums to exactly the transaction
 * weight.** Callers name only the branded portions. Whatever they do not account for becomes the
 * fungible `NA` pool by subtraction, so there is no total to disagree with, no second figure to
 * mistype, and no representable way to increment or decrement an amount other than the agreed one.
 * A caller that names *more* than the transaction weight is refused outright rather than clamped —
 * silently trimming their number would book a split they did not ask for.
 */

// a caller named a brand this supplier is not registered to deal in
export class BrandNotSuppliedError extends Data.TaggedError("BrandNotSuppliedError")<{
    supplierId: string
    brandId: string
}> {}

// the named portions come to more than the transaction weight — the one way a split can be wrong
export class BrandSplitExceedsWeightError extends Data.TaggedError("BrandSplitExceedsWeightError")<{
    named: number
    total: number
}> {}

// a split was sent where brand is not the operator's to choose: a brandLock supplier delivers one
// stamp, and 99.9% pools are keyed by origin rather than brand at all
export class BrandSplitNotApplicableError extends Data.TaggedError("BrandSplitNotApplicableError")<{
    reason: 'brand-locked' | 'purity-keyed-by-origin'
}> {}

// a brandLock supplier whose registered brands are not exactly one — an unresolvable master-data
// state, and the only alternative to guessing which of them the delivery carried
export class BrandLockMisconfiguredError extends Data.TaggedError("BrandLockMisconfiguredError")<{
    supplierId: string
    registered: number
}> {}

/**
 * Maps the split failures to HTTP, shared by both wholesale routers so the two domains cannot
 * describe the same rejection differently. Returns null for anything it does not own, letting the
 * caller's own `toHttpError` chain continue.
 */
export function brandSplitHttpError(error: unknown): [string, number] | null {
    if (error instanceof BrandNotSuppliedError) {
        return [`supplier ${error.supplierId} does not deal in brand ${error.brandId}`, 422]
    }
    if (error instanceof BrandSplitExceedsWeightError) {
        return [`brand split totals ${error.named} GB, more than the transaction's ${error.total} GB`, 422]
    }
    if (error instanceof BrandSplitNotApplicableError) {
        const why = error.reason === 'brand-locked'
            ? `this supplier ships a single brand — the whole weight goes to it`
            : `99.9% pools are keyed by origin, not brand`
        return [`no brand split can be given here: ${why}`, 422]
    }
    if (error instanceof BrandLockMisconfiguredError) {
        return [
            `supplier ${error.supplierId} is brand-locked but has ${error.registered} registered brands — it must have exactly one`,
            422,
        ]
    }
    return null
}

export interface ResolvedBrandWeight {
    brandId: string
    weightGb: number
    weightGm: number
}

export interface ResolveBrandSplitReq {
    supplierId: string
    purityId: string
    // the transaction's own snapshotted factor, never a fresh lookup — a rate change must not
    // retroactively move the gram figures on an order placed before it
    conversionFactor: number
    weightGb: number
    weightGm: number
    // the named portions, in the unit the transaction's weight was entered in
    requested: BrandSplit
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** The brands a supplier is registered to deal in, excluding the fungible sentinel. */
const findSupplierBrandIds = (supplierId: string) =>
    Effect.gen(function* () {
        const db = yield* DrizzleClient
        const rows = yield* Effect.tryPromise({
            try: () => db
                .select({ brandId: supplierBrands.brandId })
                .from(supplierBrands)
                .innerJoin(brands, eq(supplierBrands.brandId, brands.id))
                .where(and(eq(supplierBrands.supplierId, supplierId), eq(brands.active, true)))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot look up brands for supplier ${supplierId}` }),
        })
        return rows.map((r) => r.brandId).filter((id): id is string => !!id && id !== NA_BRAND)
    })

const findSupplier = (supplierId: string) =>
    Effect.gen(function* () {
        const db = yield* DrizzleClient
        const rows = yield* Effect.tryPromise({
            try: () => db.select().from(suppliers).where(eq(suppliers.id, supplierId)).execute(),
            catch: () => new RepositoryError({ message: `cannot look up supplier ${supplierId}` }),
        })
        return rows[0] ?? null
    })

const isKeyedByOrigin = (purityId: string) =>
    Effect.gen(function* () {
        const db = yield* DrizzleClient
        const rows = yield* Effect.tryPromise({
            try: () => db.select().from(purities).where(eq(purities.id, purityId)).execute(),
            catch: () => new RepositoryError({ message: `cannot look up purity ${purityId}` }),
        })
        // 99.9% is tracked by origin, not brand — the sentinel is the only pool it ever uses
        return rows[0]?.unitOfMeasure === 'g'
    })

export type BrandSplitError =
    | BrandNotSuppliedError
    | BrandSplitExceedsWeightError
    | BrandSplitNotApplicableError
    | BrandLockMisconfiguredError

export type DivideResult =
    | { ok: true; split: ResolvedBrandWeight[] }
    | { ok: false; error: BrandSplitError }

export interface DivideWeightReq extends ResolveBrandSplitReq {
    // 99.9%: pools are keyed by origin, so brand never varies within one
    keyedByOrigin: boolean
    brandLock: boolean
    // brand ids this supplier is registered to ship, sentinel already excluded
    registered: string[]
}

/**
 * The whole rule, as a pure function of facts already fetched.
 *
 * Kept separate from the lookups so it can be tested for what actually matters — that the lines
 * always reconstruct the transaction's weights — without a database anywhere near it.
 */
export function divideWeight(req: DivideWeightReq): DivideResult {
    const whole: ResolvedBrandWeight[] = [
        { brandId: NA_BRAND, weightGb: req.weightGb, weightGm: req.weightGm },
    ]

    // 99.9% never splits: its pools are keyed by origin, so every stamp lands in the same one
    if (req.keyedByOrigin) {
        if (req.requested.length > 0) {
            return { ok: false, error: new BrandSplitNotApplicableError({ reason: 'purity-keyed-by-origin' }) }
        }
        return { ok: true, split: whole }
    }

    // A locked supplier stamps everything it ships. There is nothing to enter, so anything entered
    // is a mistake — accepting it would let the UI book a mix this supplier cannot send.
    if (req.brandLock) {
        if (req.requested.length > 0) {
            return { ok: false, error: new BrandSplitNotApplicableError({ reason: 'brand-locked' }) }
        }
        if (req.registered.length !== 1) {
            return {
                ok: false,
                error: new BrandLockMisconfiguredError({
                    supplierId: req.supplierId, registered: req.registered.length,
                }),
            }
        }
        return { ok: true, split: [{ brandId: req.registered[0], weightGb: req.weightGb, weightGm: req.weightGm }] }
    }

    // merge duplicates rather than reject them — two lines for the same stamp are one pool
    const merged = new Map<string, number>()
    for (const entry of req.requested) {
        if (!req.registered.includes(entry.brandId)) {
            return {
                ok: false,
                error: new BrandNotSuppliedError({ supplierId: req.supplierId, brandId: entry.brandId }),
            }
        }
        merged.set(entry.brandId, (merged.get(entry.brandId) ?? 0) + entry.weight)
    }

    const named = round6([...merged.values()].reduce((sum, w) => sum + w, 0))
    if (named > req.weightGb) {
        return { ok: false, error: new BrandSplitExceedsWeightError({ named, total: req.weightGb }) }
    }
    if (named === 0) return { ok: true, split: whole }

    // grams follow the transaction's own factor so each line reconciles with the order
    const split: ResolvedBrandWeight[] = [...merged].map(([brandId, weightGb]) => ({
        brandId,
        weightGb,
        weightGm: round6(weightGb * req.conversionFactor),
    }))

    // The residual is what makes the sum exact. Taking it by subtraction rather than by
    // reconversion is deliberate: the branded lines plus this one always restore the transaction's
    // stored weights to the last decimal, whatever the factor rounds to.
    const remainderGb = round6(req.weightGb - named)
    if (remainderGb > 0) {
        const remainderGm = round6(req.weightGm - split.reduce((sum, s) => sum + s.weightGm, 0))
        /**
         * Folded into an existing NA line rather than pushed alongside it.
         *
         * `NA` is ordinarily the residual's home and nothing else, so this appears to be a case
         * that cannot arise — but it can: registering `NA` in `suppler_brands` is a data change,
         * not a code change, and an operator could then name it explicitly *and* leave a
         * remainder. Pushing unconditionally emitted the same pool twice in one split.
         *
         * Two rows for one pool sum correctly, so nothing was visibly wrong — but each becomes its
         * own inventory movement, `findBrandSplitByReference` reads the transaction back with a
         * duplicated brand, and the unique index that now guards against double-booking would
         * reject the whole booking. One pool, one line.
         */
        const existingNa = split.find((line) => line.brandId === NA_BRAND)
        if (existingNa) {
            existingNa.weightGb = round6(existingNa.weightGb + remainderGb)
            existingNa.weightGm = round6(existingNa.weightGm + remainderGm)
        } else {
            split.push({ brandId: NA_BRAND, weightGb: remainderGb, weightGm: remainderGm })
        }
    }

    return { ok: true, split }
}

/** Fetches the three facts `divideWeight` needs, then applies it. */
export const resolveBrandSplit = (req: ResolveBrandSplitReq) =>
    Effect.gen(function* () {
        const [keyedByOrigin, supplier, registered] = yield* Effect.all([
            isKeyedByOrigin(req.purityId),
            findSupplier(req.supplierId),
            findSupplierBrandIds(req.supplierId),
        ])

        const result = divideWeight({
            ...req,
            keyedByOrigin,
            brandLock: supplier?.brandLock ?? false,
            registered,
        })
        if (!result.ok) return yield* Effect.fail(result.error)
        return result.split
    })

/**
 * Apportions a transaction's money across the split by weight, with the last line taking whatever
 * the earlier ones left. Rounding each line independently would drift the sum off the recorded
 * total by a satang or two, and inventory cost has to reconcile to the transaction exactly.
 */
export const apportionCost = (split: ResolvedBrandWeight[], totalCost: number, totalWeightGb: number) => {
    if (split.length === 0) return []
    let assigned = 0
    return split.map((line, i) => {
        if (i === split.length - 1) return { ...line, totalCost: round6(totalCost - assigned) }
        const share = round6(totalWeightGb > 0 ? (totalCost * line.weightGb) / totalWeightGb : 0)
        assigned = round6(assigned + share)
        return { ...line, totalCost: share }
    })
}
