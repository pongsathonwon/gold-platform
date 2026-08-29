/**
 * When the nightly confirm sweep next runs.
 *
 * Both wholesale domains end their edit window with a bulk `confirm-all` sweep rather than a
 * per-order deadline. `confirmDueAt` records when the next sweep lands, so the UI can tell an
 * operator how long their transaction stays editable. It is **informational only** — the job is
 * the cutoff and nothing in the API tests against this value.
 *
 * Informational or not, it is read by a person standing in a shop in Bangkok, so it is computed
 * on Bangkok's clock. It used to use `Date.prototype.setHours`, which resolves against the
 * *host's* timezone: on a UTC server — which is what Cloud Run gives you — an hour of `0` meant
 * midnight UTC, and the operator was told 07:00 for a sweep that had already run. The hour is a
 * wall-clock hour in the shop, not on the machine, and this module is the only place that
 * conversion happens.
 *
 * It lives in `infrastructure/` beside `settlement.ts` and `weight.ts` because both wholesale
 * ports need it and each carries its own env var. Duplicated timezone arithmetic is exactly the
 * kind that gets fixed in one copy.
 */

import { BUSINESS_UTC_OFFSET, businessDateOf, shiftBusinessDate } from "@gold-platform/types";

/** Midnight, matching the default `confirm-all` cron. */
export const DEFAULT_AUTO_CONFIRM_HOUR = 0

/**
 * The sweep hour from an env var, as a wall-clock hour in Bangkok.
 *
 * Anything that is not a whole 0–23 falls back to the default rather than failing: this drives a
 * hint in the UI, and refusing to start the server over a malformed optional hint would trade a
 * cosmetic problem for an outage. `Number('')` is `0` and `Number(undefined)` is `NaN`, so both
 * unset and empty land on the default via the integer check.
 */
export function autoConfirmHour(raw: string | undefined): number {
    const hour = Number(raw)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return DEFAULT_AUTO_CONFIRM_HOUR
    return hour
}

/**
 * The next time the nightly job runs at or after `from`, as an instant.
 *
 * `hour` is a wall-clock hour in Bangkok. The Bangkok day `from` falls in comes from
 * `businessDateOf` — the same helper every business date in the system goes through — and the
 * offset turns that day plus the hour back into a real instant. Both steps are explicit about the
 * zone, so the result does not depend on where the process runs.
 *
 * Strictly after: a `from` sitting exactly on the sweep hour gets tomorrow's run, because this
 * moment's sweep is the one already taking the transaction out of the edit window.
 */
export function nextAutoConfirmAt(from: Date, hour: number): Date {
    const today = businessDateOf(from)
    const at = (day: string) =>
        new Date(`${day}T${String(hour).padStart(2, '0')}:00:00${BUSINESS_UTC_OFFSET}`)

    const todaysRun = at(today)
    return todaysRun > from ? todaysRun : at(shiftBusinessDate(today, 1))
}
