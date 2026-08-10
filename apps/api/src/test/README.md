# API tests — what they cover, and what they deliberately do not

`pnpm --filter @gold-platform/api test` · vitest, no database, no server.

## The idea

Every dependency a usecase reaches for is either a `Context.Tag` or a single factory module, so the
ports can be swapped for in-memory fakes and the domain logic runs **unchanged**. These are not
mocked-out unit tests of individual functions — `advanceStatus` executes exactly as it does in
production, guards and all. Only the edges are replaced.

Three seams per suite:

| Mocked | Replaced with | Why |
|---|---|---|
| `adapter/<domain>.repository.js` | in-memory repo from `test/fakes.ts` | holds one transaction and its full status log, so a test can assert *how many* rows a call wrote |
| `core/inventory/application/inventory.usecase.js` | `vi.fn()` spies returning `Effect.void` | the question is *did the hook fire, once, with what* — inventory's own correctness is a separate concern |
| `infrastructure/quantity.js` | fixed resolvers | they hit the DB for the product-type/purity rule, and the numbers are not what these tests are about |

### One trap worth knowing

The repository holder must be `vi.hoisted` **and read lazily**:

```ts
const holder = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock("../adapter/wholesale-buy.repository.js", async () => {
    const { Effect } = await import("effect");
    return { makeWholeBuyRepository: Effect.sync(() => holder.repo) };   // not Effect.succeed
});
```

`wholeBuyLive` is built once when the usecase module loads. `Effect.succeed(holder.repo)` captures
whatever the holder held *then* — `undefined` — for every test in the file, and the symptom is a
`Die` rather than a clean failure. `Effect.sync` defers the read to run time.

## What is covered

Everything in the state machine that is **not** the transition map — the map itself is shared with
the web app and tested there:

- transition rejection, and that a rejected move writes **nothing**
- note required on every failure branch, including whitespace-only notes
- `returnReason` required on `RETURNED`, in both domains
- which effect each move owns: increment on `STOCKED`, decrement on `PACKED`, reversal on
  `RETURNED`, contested weight on `DISPUTED`, `settledAmount` on `PAID`
- that accepting and packing take **no weight**, so a supplied one cannot change what moves
- that acceptance clears a contested weight recorded by an earlier dispute
- that `settledAmount` is cleared when a retry settles exactly
- `receive-stock` writing **both** status rows — the property the "splitting later needs no
  migration" promise rests on
- **ordering**: the inventory hook runs before the status row, so a failed movement never leaves a
  log entry claiming it happened

Each of these was mutation-checked when written: the guard was removed, the hook moved, the
ordering swapped, and the suite was confirmed to fail on exactly the relevant test.

## What is NOT covered

Do not read a green run as "the domain is safe end to end":

1. **No SQL runs.** The repository implementations, the Drizzle queries, and migration `0009` are
   untested. A column that does not exist would pass here and fail in production.
2. **Live-WAC decrement under row lock** — `decrementBalance` computing cost inside a locked
   transaction is the one piece that genuinely needs Postgres. Not covered anywhere.
3. **No HTTP layer.** Zod validation, `toHttpError` status-code mapping, and JWT auth are untested;
   the suites call usecases directly.
4. **Inventory internals.** `increment`/`decrement`/`reverseDecrement` are spies here and have no
   tests of their own.
5. **`createTransaction` pricing.** The quantity resolvers are stubbed, so the derived-price and
   settlement-period paths are only covered by the shared-types tests in the web app.

The natural next step, if this is worth extending, is a testcontainers Postgres for (1) and (2) —
which is a different kind of test with a different cost, and worth deciding on separately.
