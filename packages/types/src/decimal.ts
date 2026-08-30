/**
 * Rounding for the figures that get stored.
 *
 * Every money and weight column in this system is a Postgres `numeric` read in drizzle's
 * `mode: 'number'`, so values arrive as IEEE-754 doubles and derived ones were written back
 * unrounded. `weightGb * pricePerGb` for 15.2 baht at 40,350.10 is 613321.5199999999, and that is
 * the number that went into `total_amount`. Two decimals of display formatting hid it on screen
 * while the residue stayed on the row and accumulated through the weighted-average cost.
 *
 * The fix has two halves and needs both:
 *
 *   1. **The columns declare a scale**, so Postgres quantizes anything written to them.
 *   2. **Derived values are rounded here, at the point they are computed**, so the number the
 *      application believes it stored is the number the database actually stored.
 *
 * Doing only (1) would leave the app holding a different value from the row for the rest of the
 * request. Doing only (2) would leave the column willing to accept anything.
 *
 * **This is not arbitrary-precision arithmetic**, and it is worth being exact about what it buys.
 * A double represents every value on the 2-decimal grid uniquely below about 9·10¹³, and on the
 * 6-decimal grid below about 9·10⁹ — far above any weight or amount this business handles — so a
 * quantized value round-trips through `number` losslessly. What is bounded rather than eliminated
 * is error *inside* a chain of arithmetic, which is why rounding happens at each stored step
 * instead of once at the end. True decimal arithmetic end to end means a decimal type on the wire
 * and in the UI, which is a much larger change than this one.
 */

/** Money, in satang. Two decimals is what a THB figure means. */
export const MONEY_SCALE = 2

/**
 * Weight, in gold baht or grams.
 *
 * Six decimals because that is what the brand split already used, and the split's correctness
 * argument depends on it: the residual line is computed by subtraction, so the named lines and the
 * remainder only reconstruct the transaction weight exactly if both are rounded the same way.
 * One microgram is well past any scale that can be weighed.
 */
export const WEIGHT_SCALE = 6

/** Gram-per-gold-baht conversion, matching `unit_conversion.factor_value`. */
export const FACTOR_SCALE = 4

/**
 * Rounds to `scale` decimal places, the way the database will.
 *
 * **It rounds the decimal text, not the binary value, and that is the whole design.** Drizzle
 * writes a `mode: 'number'` numeric with `String(value)`, so what Postgres receives is
 * `String(value)` — the shortest decimal that round-trips this double — and it rounds *that*
 * exactly. Any implementation which instead does arithmetic on the double will disagree with the
 * column, and then the value the application believes it stored is not the value on the row.
 *
 * That is not theoretical. Two earlier attempts both failed a differential test against Postgres
 * over 38,000 values:
 *
 *   - `Math.round(v * 100) / 100` — the multiply reintroduces the error being removed. `1.005 * 100`
 *     is `100.49999999999999`, so it answers 1.00 where every person and every ledger means 1.01.
 *   - Shifting the point by re-parsing `"1.005e2"` — fixes that case, but re-parsing lands on a
 *     *different double* whenever the shifted text sits within half an ulp of a boundary.
 *     `String(0.46499999999999997) + "e2"` parses to exactly 46.5 and rounds up, while Postgres
 *     reads the text as less than 0.465 and rounds down. 136 disagreements.
 *
 * Reading the digits directly has neither problem: the first dropped digit decides, which is
 * half-away-from-zero on the decimal — exactly what Postgres does to a `numeric` (`-0.005` in a
 * `numeric(10,2)` stores as `-0.01`, and `round(-2.5)` is `-3`, where JS `Math.round` is half-*up*
 * and would answer `-0.00` and `-2`).
 */
export function roundTo(value: number, scale: number): number {
    if (!Number.isFinite(value)) return value

    const text = String(value)

    // Exponential notation — |value| below 1e-6 or at/above 1e21. Both are far outside any weight
    // or amount this business handles, and at these scales the answer is zero or the value itself,
    // so toFixed is left to it rather than growing a decimal-expansion path nothing exercises.
    if (text.includes("e") || text.includes("E")) {
        return normalise(Number(value.toFixed(clampScale(scale))))
    }

    const negative = text.startsWith("-")
    const unsigned = negative ? text.slice(1) : text
    const point = unsigned.indexOf(".")
    if (point === -1) return normalise(value) // already an integer

    const fraction = unsigned.slice(point + 1)
    if (fraction.length <= scale) return normalise(value) // already on the grid

    // The magnitude as an integer of `scale` decimal places, then one increment if the first
    // dropped digit is 5 or more. BigInt so the carry is exact however long the digit string is.
    const whole = unsigned.slice(0, point)
    const scaled = BigInt(whole + fraction.slice(0, scale).padEnd(scale, "0"))
    const carried = fraction.charCodeAt(scale) >= 53 /* '5' */ ? scaled + 1n : scaled

    const digits = carried.toString().padStart(scale + 1, "0")
    const cut = digits.length - scale
    const rebuilt = `${negative ? "-" : ""}${digits.slice(0, cut)}${scale > 0 ? `.${digits.slice(cut)}` : ""}`
    return normalise(Number(rebuilt))
}

const clampScale = (scale: number) => Math.min(Math.max(Math.trunc(scale), 0), 100)

/**
 * Never hand back -0: it is a different value to JSON and to a reader, and the same one to the
 * column.
 */
const normalise = (value: number) => (value === 0 ? 0 : value)

/** A THB amount as it will be stored. */
export const roundMoney = (value: number) => roundTo(value, MONEY_SCALE)

/** A weight in gold baht or grams as it will be stored. */
export const roundWeight = (value: number) => roundTo(value, WEIGHT_SCALE)
