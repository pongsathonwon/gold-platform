import { decimal } from "drizzle-orm/pg-core";
import { FACTOR_SCALE, MONEY_SCALE, WEIGHT_SCALE } from "@gold-platform/types";

/**
 * The three shapes a number takes in this schema.
 *
 * Every one of these columns used to be a bare `decimal({ mode: 'number' })` — Postgres `numeric`
 * with **no precision and no scale**, which accepts whatever it is given. Combined with
 * `mode: 'number'`, that meant a derived figure went in as an unrounded double and stayed there:
 * `weightGb * pricePerGb` for 15.2 baht at 40,350.10 stored as 613321.5199999999. Two decimals of
 * display formatting hid it on screen while the residue sat on the row and accumulated through the
 * weighted-average cost.
 *
 * Declaring the scale makes the database quantize on write, so a row cannot hold a figure finer
 * than the unit it is denominated in. It is half of the fix — the other half is `roundMoney` /
 * `roundWeight` at the point each value is computed, so the number the application holds is the
 * number the row holds. See `packages/types/src/decimal.ts`.
 *
 * **They are helpers rather than a repeated config object on purpose.** The convention is only
 * worth anything if it is total; a `decimal(14,2)` pinned on the newest table while the older ones
 * stay bare is how a schema ends up with two conventions and no way to tell which a given column
 * follows. Adding a money column should not require remembering a number.
 *
 * `mode: 'number'` stays. A double represents every value on the 2-decimal grid uniquely below
 * ~9·10¹³ and the 6-decimal grid below ~9·10⁹ — orders of magnitude above any amount or weight
 * this business handles — so a quantized value round-trips through `number` losslessly. Moving to
 * string mode would change the inferred type of every row, and therefore every hook, every sum and
 * every table cell in the web app, to buy precision that is not in question at this scale.
 */

/** THB. Precision 18 leaves 16 integer digits — far past any figure the shop can transact. */
const MONEY = { precision: 18, scale: MONEY_SCALE, mode: "number" } as const

/** Gold baht or grams. Six decimals is one microgram; 10 integer digits is 10,000 tonnes. */
const WEIGHT = { precision: 16, scale: WEIGHT_SCALE, mode: "number" } as const

/** Grams per gold baht, matching `unit_conversion.factor_value` exactly. */
const FACTOR = { precision: 6, scale: FACTOR_SCALE, mode: "number" } as const

export const money = (name?: string) => (name ? decimal(name, MONEY) : decimal(MONEY))
export const weight = (name?: string) => (name ? decimal(name, WEIGHT) : decimal(WEIGHT))
export const factor = (name?: string) => (name ? decimal(name, FACTOR) : decimal(FACTOR))
