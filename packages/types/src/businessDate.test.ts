import { describe, it, expect } from 'vitest'
import { shiftBusinessDate, startOfBusinessMonth, todayBusinessDate } from './index'

describe('startOfBusinessMonth', () => {
  it('walks back to the first of the month', () => {
    expect(startOfBusinessMonth('2026-09-21')).toBe('2026-09-01')
  })

  it('is a no-op on the first itself', () => {
    expect(startOfBusinessMonth('2026-09-01')).toBe('2026-09-01')
  })

  it('does not step into the previous month at either edge of a day', () => {
    // The bug this helper exists to avoid: anything that builds a `Date` from a bare ISO day
    // parses it as UTC midnight, which is 07:00 in Bangkok and the *previous* evening anywhere
    // west of Greenwich. A slice has no instant to misplace.
    expect(startOfBusinessMonth('2026-03-01')).toBe('2026-03-01')
    expect(startOfBusinessMonth('2026-03-31')).toBe('2026-03-01')
  })

  it('handles February and a year boundary without a month-length table', () => {
    expect(startOfBusinessMonth('2024-02-29')).toBe('2024-02-01')
    expect(startOfBusinessMonth('2026-01-01')).toBe('2026-01-01')
    expect(startOfBusinessMonth('2026-12-31')).toBe('2026-12-01')
  })

  it('agrees with stepping back day by day', () => {
    // An independent check that the slice lands where walking would, for every day of a 31-day
    // month — the arithmetic route is `shiftBusinessDate`, which does build a UTC Date.
    for (let d = 1; d <= 31; d += 1) {
      const day = `2026-07-${String(d).padStart(2, '0')}`
      expect(startOfBusinessMonth(day)).toBe(shiftBusinessDate(day, -(d - 1)))
    }
  })

  it('anchors a month-to-date window that never opens in the future', () => {
    const today = todayBusinessDate()
    expect(startOfBusinessMonth(today) <= today).toBe(true)
  })
})
