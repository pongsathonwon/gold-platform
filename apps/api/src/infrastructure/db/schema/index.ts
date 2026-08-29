/**
 * Two kinds of time live in this schema, and they are not interchangeable.
 *
 * **`date`** — a calendar day with no instant behind it: `transactionDate`, `movementDate`,
 * `effectiveDate`. All the picked day decides is which Fri–Thu settlement period a record lands
 * in, and that boundary falls on a day. Drizzle maps these to plain `YYYY-MM-DD` strings in both
 * directions, so no timezone touches them. **Do not make these timezone-aware** — it would put
 * back exactly the ambiguity the business-date design removes.
 *
 * **`timestamp({ withTimezone: true })`** — an absolute instant: `recordedAt`, `movedAt`,
 * `auditedAt`, `switchedAt`, `createdAt`, `confirmDueAt`. These are `timestamptz`, and the reason
 * is that every one of them has *two* writers whose conventions only coincide by accident on a
 * naive column:
 *
 *   - the app, via Drizzle's `value.toISOString()` — a naive column drops the offset and keeps the
 *     UTC wall clock, whatever the session is set to;
 *   - `defaultNow()`, via Postgres `now()` — a `timestamptz` that an implicit cast to a naive
 *     column converts into the *session's* timezone first.
 *
 * On a UTC session those agree, which is why the naive columns worked. Change the instance
 * timezone, or connect a client that sets its own, and the same column starts holding both
 * conventions with nothing recording which row used which — and mixed rows cannot be untangled
 * afterwards. `timestamptz` stores an instant, so both writers agree by construction.
 *
 * Migration `0018_timestamptz` converted them with `AT TIME ZONE 'UTC'`, which was exact because
 * every existing row was written under a UTC session. Application code is unaffected: Drizzle's
 * contract is a JS `Date` in and out either way.
 */

export * from "./user.schema.js";
export * from './master.schema.js'
export * from './inventory.schema.js'
export * from './retail-buy.schema.js'
export * from './retail-sell.schema.js'
export * from './wholesale-sell.schema.js'
export * from './wholesale-buy.schema.js'
export * from './received.schema.js'