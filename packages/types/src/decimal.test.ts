import { describe, expect, it } from "vitest"
import { MONEY_SCALE, roundMoney, roundTo, roundWeight, WEIGHT_SCALE } from "./decimal.js"

describe("rounding a stored figure", () => {
    it("removes the residue a price multiplication leaves behind", () => {
        // The case that started this: 15.2 gold baht at 40,350.10 THB.
        expect(15.2 * 40350.1).toBe(613321.5199999999)
        expect(roundMoney(15.2 * 40350.1)).toBe(613321.52)
    })

    it("rounds a half up and away from zero, the way the column will", () => {
        // Postgres numeric is half-away-from-zero: 0.005 in a numeric(10,2) stores as 0.01, and
        // round(-2.5) is -3. JS Math.round is half-*up*, which disagrees on every negative half.
        expect(roundMoney(0.005)).toBe(0.01)
        expect(roundMoney(0.015)).toBe(0.02)
        expect(roundMoney(0.025)).toBe(0.03)
        expect(roundMoney(-0.005)).toBe(-0.01)
        expect(roundMoney(-0.015)).toBe(-0.02)
        expect(roundTo(-2.5, 0)).toBe(-3)
        expect(roundTo(2.5, 0)).toBe(3)
    })

    it("does not lose a half to the scaling multiply", () => {
        // `1.005 * 100` is 100.49999999999999, so the obvious implementation answers 1.00 here.
        expect(1.005 * 100).toBe(100.49999999999999)
        expect(roundMoney(1.005)).toBe(1.01)
        expect(roundMoney(1.015)).toBe(1.02)
        expect(roundMoney(8.165)).toBe(8.17)
    })

    it("leaves a value that is already on the grid exactly alone", () => {
        for (const v of [0, 1, 0.1, 0.5, 40350.1, 613321.52, -99.99, 1234567.89]) {
            expect(roundMoney(v)).toBe(roundMoney(roundMoney(v)))
        }
        expect(roundMoney(613321.52)).toBe(613321.52)
        expect(roundWeight(15.244)).toBe(15.244)
    })

    it("never hands back negative zero", () => {
        // -0 is a different value to JSON and to a reader, and the same one to the column.
        expect(Object.is(roundMoney(-0.0001), 0)).toBe(true)
        expect(Object.is(roundMoney(-0), 0)).toBe(true)
        expect(Object.is(roundWeight(-1e-9), 0)).toBe(true)
    })

    it("carries a weight to six places and no further", () => {
        expect(roundWeight(1 / 3)).toBe(0.333333)
        expect(roundWeight(2 / 3)).toBe(0.666667)
        // 12 - 8 - 4 must read as 0, not 1e-15 — this is what the brand-split residual relies on.
        expect(roundWeight(12 - 8 - 4)).toBe(0)
        expect(roundWeight(0.1 + 0.2)).toBe(0.3)
    })

    it("agrees with Postgres on the values that broke the earlier attempts", () => {
        // Every pair here is `[input, what a numeric(24,scale) column stores]`, taken from a
        // differential run against Postgres over 38,002 values. These are the cases where rounding
        // the *double* and rounding the *decimal text Postgres receives* give different answers —
        // the shifted text lands within half an ulp of a boundary and parses to the other side of
        // it. Postgres is the authority: drizzle writes the column with String(value).
        const cases: Array<[number, number]> = [
            [-0.46499999999999997, -0.46],
            [0.46499999999999997, 0.46],
            [-0.40499999999999997, -0.4],
            [0.024999999999999998, 0.02],
            [1.4649999999999999, 1.46],
            [1497180.2449999999, 1497180.24],
            [12422211.274999999, 12422211.27],
            [-11659255.264999999, -11659255.26],
            [14006332.504999999, 14006332.5],
        ]
        for (const [input, stored] of cases) expect(roundMoney(input)).toBe(stored)
    })

    it("passes the non-finite through rather than inventing a number", () => {
        expect(roundMoney(Number.NaN)).toBeNaN()
        expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
        expect(roundMoney(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY)
    })

    it("survives values whose own notation is exponential", () => {
        // `${1e-7}e2` is unparseable, so these take the toFixed path.
        expect(roundMoney(1e-7)).toBe(0)
        expect(roundWeight(1e-21)).toBe(0)
        expect(roundMoney(1e21)).toBe(1e21)
    })

    it("holds the round-trip that lets the column stay mode:'number'", () => {
        // A quantized value must survive number -> text -> number unchanged, or storing it as a
        // double would be lossy however carefully it was rounded. This is the property the whole
        // approach rests on, so it is asserted rather than assumed.
        const scales = [MONEY_SCALE, WEIGHT_SCALE] as const
        for (const scale of scales) {
            const ceiling = scale === MONEY_SCALE ? 1e9 : 1e6
            for (let i = 0; i < 2000; i++) {
                const raw = (Math.random() - 0.4) * ceiling
                const rounded = roundTo(raw, scale)
                expect(Number(String(rounded))).toBe(rounded)
                expect(Number(rounded.toFixed(scale))).toBe(rounded)
                // and rounding it again changes nothing
                expect(roundTo(rounded, scale)).toBe(rounded)
            }
        }
    })
})
