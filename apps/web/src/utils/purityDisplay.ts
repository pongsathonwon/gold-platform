/**
 * How a weight is shown, given its purity.
 *
 * Two rules, stated once here because getting them inconsistent puts two different numbers for the
 * same gold on the same screen — which is what both detail pages were doing:
 *
 *  1. **96.5% is gold baht, 99.9% is kilograms.** Never gold baht for 99.9% (a 2 kg order shown as
 *     131.20 GB is a number nobody typed) and never grams either — grams is the storage unit, not
 *     the ordering unit. The detail pages rendered `weightGm` as "2000 กรัม" in the summary and
 *     `weightGm / 1000` as "2 kg" in the dialog eleven lines below it.
 *  2. **Which purity a row is comes from master data, never from its id.** `purityId === "999"`
 *     was hard-coded on both detail pages; a renamed id or a third purity silently reclassifies
 *     the whole page, and the id is data the shop administers.
 */

/** The percent that marks investment-grade gold — the pool ordered in kilograms and keyed by origin. */
export const INVESTMENT_GRADE_PERCENT = 99.9;

export type PurityLike = { percent: number };

/** Whether a purity is the 99.9% investment grade. Pass the master-data row, not an id. */
export const isInvestmentGrade = (purity: PurityLike | undefined) =>
  purity?.percent === INVESTMENT_GRADE_PERCENT;

/** The unit a purity's weights are shown in. */
export const weightUnitLabel = (investmentGrade: boolean) => (investmentGrade ? "กก." : "บาท");

/**
 * A stored weight pair rendered in the unit its purity is ordered in.
 *
 * Every caller holds both `weightGb` and `weightGm` — the server resolves both at creation — so
 * this takes the pair rather than making each call site remember which one to divide.
 */
export const displayWeight = (
  investmentGrade: boolean,
  weight: { weightGb: number; weightGm: number },
) => (investmentGrade ? weight.weightGm / 1000 : weight.weightGb);
