import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO_CONFIRM_HOUR, autoConfirmHour, nextAutoConfirmAt } from './auto-confirm.js'

// Every expectation here is an absolute instant, written as UTC. That is the whole point of the
// test: the answers must not move when the host's timezone does, so none of them is expressed in
// local time. Bangkok is UTC+7, so midnight in the shop is 17:00Z the previous day.

const iso = (at: Date) => at.toISOString()

describe('autoConfirmHour', () => {
    it('reads a whole hour in range', () => {
        expect(autoConfirmHour('0')).toBe(0)
        expect(autoConfirmHour('5')).toBe(5)
        expect(autoConfirmHour('23')).toBe(23)
    })

    it('falls back to the default rather than throwing, for anything else', () => {
        // An unparseable hint must not take the server down with it — it drives a label, not a rule.
        for (const raw of [undefined, '', ' ', '24', '-1', '5.5', 'midnight']) {
            expect(autoConfirmHour(raw)).toBe(DEFAULT_AUTO_CONFIRM_HOUR)
        }
    })
})

describe('nextAutoConfirmAt', () => {
    it('finds tonight’s midnight sweep from the middle of a trading day', () => {
        // 09:00Z is 16:00 in the shop on the 12th; the next midnight sweep is the 13th, 00:00 ICT.
        expect(iso(nextAutoConfirmAt(new Date('2026-06-12T09:00:00Z'), 0)))
            .toBe('2026-06-12T17:00:00.000Z')
    })

    it('is right after Bangkok midnight but before UTC midnight', () => {
        // The regression this module exists for. 18:00Z is already 01:00 on the 13th in the shop,
        // so tonight's sweep has run and the next is the 14th at 00:00 ICT. The old `setHours`
        // version on a UTC host answered 2026-06-13T00:00:00Z — 07:00 ICT, seven hours early and
        // on a sweep that does not exist.
        expect(iso(nextAutoConfirmAt(new Date('2026-06-12T18:00:00Z'), 0)))
            .toBe('2026-06-13T17:00:00.000Z')
    })

    it('skips a sweep landing exactly on `from`', () => {
        // 17:00Z *is* midnight in the shop. That sweep is the one closing this transaction's edit
        // window, so the next one an operator can still beat is tomorrow's.
        expect(iso(nextAutoConfirmAt(new Date('2026-06-12T17:00:00Z'), 0)))
            .toBe('2026-06-13T17:00:00.000Z')
    })

    it('honours a non-midnight cron hour', () => {
        // 22:00 ICT on the 12th is 15:00Z, still ahead of a 09:00Z `from`.
        expect(iso(nextAutoConfirmAt(new Date('2026-06-12T09:00:00Z'), 22)))
            .toBe('2026-06-12T15:00:00.000Z')
    })

    it('rolls over a year boundary', () => {
        // 18:00Z on new year's eve is 01:00 on the 1st in the shop.
        expect(iso(nextAutoConfirmAt(new Date('2026-12-31T18:00:00Z'), 0)))
            .toBe('2027-01-01T17:00:00.000Z')
    })

    it('always lands strictly ahead of `from`, across a full day of instants', () => {
        // The invariant the UI depends on: a countdown is never zero or negative.
        for (let hour = 0; hour < 24; hour++) {
            const from = new Date(Date.UTC(2026, 5, 12, hour, 30))
            for (const cron of [0, 7, 22]) {
                expect(nextAutoConfirmAt(from, cron).getTime()).toBeGreaterThan(from.getTime())
            }
        }
    })
})
