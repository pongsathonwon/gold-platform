/**
 * Settlement period — the reporting bucket every transaction is assigned when it is created.
 *
 * A period runs Fri 00:00 → Thu 23:59. Callers never supply it: it is derived server-side from
 * the transaction's **business date** — the day the operator says the deal happened, not the
 * instant the row was written. An order backdated to last Thursday belongs in last week's period;
 * deriving the bucket from the insert time would make backdating cosmetic.
 *
 * The label is an ISO-week string (e.g. "2026-W24"). Because the business week starts on Friday
 * rather than Monday, the date is shifted back 4 days before the ISO week is computed — that maps
 * each Fri–Thu span exactly onto one Mon–Sun ISO week, so no two periods share a label.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const FRIDAY_OFFSET_DAYS = 4

/** Monday of the ISO week containing `date`, at UTC midnight. */
function isoWeekMonday(date: Date): Date {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    // getUTCDay(): Sunday = 0 → treat as 7 so Monday = 1 … Sunday = 7
    const isoDay = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay()
    utc.setUTCDate(utc.getUTCDate() - (isoDay - 1))
    return utc
}

/** ISO-8601 week number and week-year — the week-year differs from the calendar year at boundaries. */
function isoWeek(date: Date): { year: number; week: number } {
    const monday = isoWeekMonday(date)
    // the ISO week-year is whichever year owns that week's Thursday
    const thursday = new Date(monday.getTime() + 3 * DAY_MS)
    const year = thursday.getUTCFullYear()
    const firstThursday = new Date(Date.UTC(year, 0, 4))
    const firstMonday = isoWeekMonday(firstThursday)
    const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * DAY_MS)) + 1
    return { year, week }
}

/**
 * Resolves the Fri–Thu settlement period a timestamp falls in.
 * `resolveSettlementPeriod(new Date('2026-06-12T09:00:00Z')) === '2026-W24'`
 */
export function resolveSettlementPeriod(at: Date = new Date()): string {
    const shifted = new Date(at.getTime() - FRIDAY_OFFSET_DAYS * DAY_MS)
    const { year, week } = isoWeek(shifted)
    return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * The period a picked business day (`YYYY-MM-DD`) falls in — the form every transaction domain
 * actually calls, since what they hold is a day, not an instant.
 *
 * The day is read as UTC midnight, which is the calendar the whole module already computes in
 * (`isoWeekMonday` and friends use the UTC accessors throughout). No local timezone touches it,
 * so the same date string yields the same period on any machine.
 *
 * `resolveSettlementPeriodOn('2026-06-12') === '2026-W24'`
 */
export function resolveSettlementPeriodOn(businessDate: string): string {
    return resolveSettlementPeriod(new Date(`${businessDate}T00:00:00Z`))
}
