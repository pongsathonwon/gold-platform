# GoldOffice Web — Developer Context

**App:** `apps/web` (`@gold-platform/web`)  
**Branch:** `dev`  
**Last updated:** 2026-06-14  
**Read first:** Root `CONTEXT.md` — business model, gold domain rules, period model, glossary.

---

## 1. Stack

| Concern       | Choice                                                 |
| ------------- | ------------------------------------------------------ |
| Framework     | React 19                                               |
| Build tool    | Vite 6                                                 |
| UI library    | MUI (Material UI) v9 + Emotion                         |
| Data fetching | TanStack Query v5                                      |
| API client    | Hono RPC client (`hono/client`) — end-to-end type-safe |
| Routing       | React Router v7                                        |
| Validation    | Zod (shared via `@gold-platform/types`)                |
| Language      | TypeScript (strict, ESM)                               |

---

## 2. Directory Structure

```
src/
├── main.tsx              — React root, BrowserRouter
├── App.tsx               — QueryClientProvider, ThemeProvider, Routes
├── api/
│   └── client.ts         — typed Hono RPC client instance
└── components/           — UI components (currently: UserList.tsx)
```

---

## 3. API Client — Hono RPC

The web app uses Hono's typed RPC client. The API exports its `AppType` and the web imports it to get full end-to-end type safety — no manual type duplication.

```typescript
// src/api/client.ts
import type { AppType } from "@gold-platform/api";
import { hc } from "hono/client";

export const client = hc<AppType>(import.meta.env.VITE_API_URL);
```

**Calling an endpoint:**

```typescript
// GET request
const res = await client.users.$get();
if (!res.ok) throw new Error("Failed");
const data = await res.json();

// POST request
const res = await client["wholesale-buy"].$post({ json: payload });
```

The client method names mirror the route paths. If a route changes on the API, TypeScript will surface the mismatch here automatically — do not cast or bypass the types.

---

## 4. Data Fetching Pattern

All server state goes through **TanStack Query**. No direct `fetch` calls outside of query/mutation functions.

```typescript
// Query
const { data, isPending, isError } = useQuery({
  queryKey: ["wholesale-buy", filters],
  queryFn: () =>
    client["wholesale-buy"].$get({ query: filters }).then((r) => r.json()),
});

// Mutation with cache invalidation
const mutation = useMutation({
  mutationFn: (payload) =>
    client["wholesale-buy"].$post({ json: payload }).then((r) => r.json()),
  onSuccess: () =>
    queryClient.invalidateQueries({ queryKey: ["wholesale-buy"] }),
});
```

**Query key conventions:**

- List: `[domain]` or `[domain, filters]`
- Single item: `[domain, id]`
- Settlement summary: `[domain, 'settlement', period]`

---

## 5. Shared Types — `@gold-platform/types`

Zod schemas live in `packages/types/src/index.ts` and are consumed by both the API (request validation) and the web (form validation). Import from the package, never redefine locally.

```typescript
import { stockGainSchema, type StockGainReq } from "@gold-platform/types";

// Use in a form:
const parsed = stockGainSchema.safeParse(formData);
```

When adding a new transaction domain, add its request schema to `packages/types` so the web can reuse it for form validation without duplicating it.

---

## 6. Routing

Routes are declared in `App.tsx`. React Router v7 with `<Routes>` / `<Route>`.

**Sprint 1 routes (implement now):**

```
/login                    — login form (public)
/inventory                — inventory balance view, split 96.5 (GB) / 99.9 (KG), per-purity totals (protected)
/inventory/movements      — movement ledger, split by purity with per-purity totals (protected)
/inventory/gain           — stock gain form (protected)
/inventory/loss           — stock loss form (protected)
/inventory/switch         — product switch form (protected)
/wholesale-buy            — wholesale buy list, filterable by status + supplier (protected)
/wholesale-buy/new        — create form (protected)
/wholesale-buy/:id        — detail, status timeline, status actions (protected)
/wholesale-sell           — wholesale sell list, filterable by status + supplier (protected)
/wholesale-sell/new       — create form (protected)
/wholesale-sell/:id       — detail, status timeline, status actions (protected)
```

**Deferred to Sprint 2+:**

```
/                         — management dashboard (current period net)
/retail-buy
/retail-buy/:id
/retail-sell
/retail-sell/:id
/receive
/receive/:id
/period-report            — historical period net report
/master-data              — brands, purities, suppliers, branches (admin)
```

---

## 7. UI Conventions

- **MUI v9** for all UI primitives. Use MUI components — do not reach for plain HTML elements for layout or form controls.
- **Theme** is created once in `App.tsx` and passed via `ThemeProvider`. Extend it there — do not create local themes.
- **Forms** use controlled inputs with local `useState`. Validate on submit using the shared Zod schema before calling the mutation.
- **Loading / error states** come from TanStack Query (`isPending`, `isError`, `error`). Do not manage loading state manually alongside a mutation or query.

---

## 8. Environment Variables

```
VITE_API_URL=http://localhost:3000
```

All client-side env vars must be prefixed `VITE_`. Access via `import.meta.env.VITE_*`.

---

## 9. Dev Commands

```bash
npm run dev          # vite dev server — http://localhost:5173
npm run build        # tsc && vite build
npm run preview      # vite preview (built output)
npm run type-check   # tsc --noEmit
```

The API must be running at `VITE_API_URL` for data fetching to work in dev. Run both together from the repo root with `pnpm dev`.

---

## 9a. Every create form picks its own date

Recording something and it happening are two events. On day one the operator is writing up
operations that already took place, so every create form — both wholesale ones, plus stock gain
and stock loss — opens with a **วันที่ทำรายการ** field defaulting to today.

- `kind: "date"` in `DynamicFormField` renders a native day picker capped at `todayBusinessDate()`.
  A day, not a datetime: all the picked date decides is which Fri–Thu settlement period the record
  lands in, and that boundary falls on a day.
- `todayBusinessDate()` from `@gold-platform/types` is **Bangkok's** today, not the browser's. Use
  `businessDateOf(date)` to ask which business day an insert timestamp fell on — never
  `recordedAt.slice(0, 10)`, which answers in UTC.
- When the picked date is not today the field shows a `บันทึกย้อนหลัง` helper line, and the detail
  pages tag the บันทึกโดย row the same way. Same-day entry says nothing at all: the two dates
  agreeing is the ordinary case and deserves no chrome.
- **The lists show and sort by `transactionDate`**, not `recordedAt` — a backdated entry reads
  where it belongs rather than jumping to the top.
- **Both wholesale lists filter on a day window, not a settlement period**, and open on the last
  seven days (`shiftBusinessDate(todayBusinessDate(), -6)` → today, inclusive). The `งวด` column
  is gone from both. `YYYY-Www` is unreadable at a glance — W32 names no dates a reader can
  recover, and because the period is shifted 4 days off the ISO week, anyone who *does* decode it
  lands four days wrong. The bucket is a management convention for comparing buy against sell; it
  is not something an operator acts on inside one domain's worklist, so it has no place on these
  pages. When the net-position view is built it should render the period as its Fri–Thu span too,
  never as the raw code.
- The `รวม` footers carry the active window as a caption, since the totals now sum whatever range
  is picked rather than a fixed bucket.
- `formatBusinessDate()` in `utils/format.ts` renders a `YYYY-MM-DD` from its own parts. Passing it
  through `new Date()` would apply a timezone to a value that has no instant behind it.
- The movements page sends plain `from`/`to` days and shows each row's `movementDate`. It opens
  on yesterday–today, not today alone: an empty ledger first thing in the morning reads as a
  broken page rather than a quiet one.

## 9b. Wholesale Buy UI

Three pages plus one shared helper:

| File | Role |
| --- | --- |
| `pages/WholesaleBuyListPage.tsx` | split into `ทอง 96.5%` (บาท) and `ทอง 99.9%` (กก.) sections like the inventory pages, each with its own `รวม` footer. Date-window/status/supplier filters. Shows the delivered weight, with the ordered one beside it when they differ |
| `pages/WholesaleBuyCreatePage.tsx` | create form on the shared `useDynamicForm` / `DynamicFormField` pattern. **One price field only** — the 96.5% quote; `derivePricePerGb999()` previews the 99.9% figure in helper text, and the server does the real conversion. **No brand field** — see below |
| `pages/WholesaleBuyDetailPage.tsx` | summary, status timeline, action buttons + confirm dialog |
| `utils/wholeBuyStatus.ts` | chip colours, Thai labels, `nextStatuses()`, `requiresNote()` |
| `utils/format.ts` | `formatNumber()` / `formatWeight()` / `formatBusinessDate()` — domain-agnostic, shared with wholesale-sell and re-exported from both status utils |

**Action buttons come from `WHOLE_BUY_TRANSITIONS` in `@gold-platform/types`** — the same map the
API validates against, so the UI cannot offer a move the server will reject. Never hard-code a
status list in a component.

The dialog collects a **note** (mandatory for failure-branch moves, which the API rejects without
one) plus one extra field per move, and **never more than one at a time**:

| Move | Extra field |
| --- | --- |
| `DISPUTED` | the weight we contest — the only weight a buy ever records |
| `PAID` | `settledAmount`, only when the payment differed from the order |
| `RETURNED` | `returnReason` (required) — a select, not free text |
| `RECEIVE_STOCK` / `STOCKED` | the **brand split** (§9d). No weight — acceptance means it matched the document |

**Nothing diverts any more.** The old dialog collected a delivered weight on the way into
`CHECKED` and the server silently rerouted a mismatch to `DISPUTED`, so `onSuccess` had to read
the returned status and toast an error. That is gone: a delivery which fails its check at the door
is refused with `ตีกลับผู้ขาย` (`PAID → RETURNED`) before custody transfers, so the caller now
always reaches the status it asked for. Both detail pages are plain "ask and receive".

**Weights render as-is** via `formatWeight()` — a 2 kg order shows "2", not "2.000". Only money
goes through `formatNumber()`'s fixed two decimals. `formatWeight` strips binary floating-point
residue so a summed column cannot print 17 digits.

**Never show a 99.9% weight in gold baht.** It is ordered in kilograms, so a 2 kg order displayed
as its 131.20 GB equivalent is a number nobody typed. Sectioning by purity is what lets each table
state one unit in its header. `splitByPurity()` in `utils/inventoryVolume.ts` is generic over the
row shape and is the shared helper for this.

List totals exclude `CANCELLED` / `REJECTED` / `RETURNED` / `REFUNDED` / `WRITTEN_OFF` rows via
`countsTowardTotal()`, which reads the explicit `WHOLE_BUY_EXCLUDED_FROM_TOTALS` set. It is a list
rather than a `bad && terminal` test on purpose: `RETURNED` gained onward moves, and inferring
"counts toward stock" from "can still move" would start summing gold that went back to the
supplier. The footer renders whenever the section has rows,
even when every one is excluded: an explicit `0` with the exclusion caption is an answer, a missing
footer looks like a bug.

## 9c. Wholesale Sell UI

Structurally identical to the buy pages — same three-page split, same `useDynamicForm` create form,
same purity sectioning, same one-extra-field-per-move dialog.

| File | Role |
| --- | --- |
| `pages/WholesaleSellListPage.tsx` | purity-split table, date-window/status/supplier filters, bulk-confirm button |
| `pages/WholesaleSellCreatePage.tsx` | create form; one price field (96.5%), 99.9% previewed in helper text |
| `pages/WholesaleSellDetailPage.tsx` | summary, status timeline, action buttons + dialog |
| `utils/wholeSellStatus.ts` | chip colours, Thai labels, `nextStatuses()`, `requiresNote()` |

Buttons come from `WHOLE_SELL_TRANSITIONS`; never hard-code a status list. **There is no combined
pack-ship button** — packing and shipping are two ordinary transitions, so `PACKED` is a state a
deal rests in and `PACKED` rows are the "ready to ship" worklist. Buy keeps its combined
`รับของและเข้าสต๊อก` because receiving and stocking really are one moment on the floor.

Differences from the buy UI worth knowing:

- **The dialog's weight field is the buyer's number, and only theirs.** It appears on `DISPUTED`
  alone; packing collects nothing, because we boxed our own gold and the agreed weight is what
  left. `settledAmount` on `PAID` and `returnReason` on `RETURNED` work exactly as on buy.
- **The list's weight column is the agreed weight**, since that is what shipped — the packed weight
  can never differ. A contested figure renders beside it in warning colour.
- **`WRITTEN_OFF` counts toward list totals** even though it is a terminal failure: it is the one
  bad-terminal status with no reversal, so the gold really is gone. `RETURNED` does *not* count —
  its decrement was reversed, so net stock is unchanged. The rule is simply *did the gold end up
  gone*, and it reads inverted on the buy side, where `WRITTEN_OFF` means no gold ever arrived.
  The set lives in `WHOLE_SELL_EXCLUDED_FROM_TOTALS`.

## 9d. Brand is entered at the stock-moving transition — `components/BrandSplitFields.tsx`

Neither create form has a brand field, and neither transaction carries a `brandId`. An order
cannot know what stamp will turn up; a supplier that is not `brandLock` routinely ships a mix. So
`<BrandSplitFields>` appears in the buy dialog on `รับของและเข้าสต๊อก` / `เข้าสต๊อกแล้ว` and in the
sell dialog on `เบิกทองแพ็คแล้ว` — the two moments gold actually enters or leaves a pool.

- **A `brandLock` supplier gets an `<Alert>`, not a field.** Its one registered brand takes 100%,
  so the only legal value is already known and a field could only be got wrong.
- Everyone else gets one number per brand from `useSupplierBrands(supplierId)`, plus a **disabled**
  `อื่นๆ (ที่เหลือ)` row showing `brandSplitRemainder()` from `@gold-platform/types` — the same
  helper the server subtracts with, so the preview is the booking.
- **An unequal split cannot be typed.** There is no total field and no residual field; each named
  input is clamped on change to the headroom left by the *other* brands, so typing 20 into a
  12-baht order yields 12. Only the named lines are sent (`toBrandSplit()` drops blanks and
  zeroes) — the server computes the residual itself, so nothing on the wire can disagree with the
  transaction weight.
- 99.9% passes `applicable={false}` and the component renders nothing: those pools are keyed by
  origin, so brand is not a dimension of them.

Both detail pages show the **recorded** split on the `ยี่ห้อ` row, read from `data.brandSplit`,
which the API derives from the inventory movements booked under the transaction rather than from
any column. Before the stock-moving transition it reads `— (บันทึกเมื่อเข้าสต๊อก)`, because there
genuinely is no answer yet. Neither list page shows brand, so neither needed changing.

## 9e. Excel export — `utils/inventoryExport.ts`

Both inventory pages export to `.xlsx`. **One workbook per page, two sheets per workbook** —
`ทอง 96.5%` and `ทอง 99.9%`, the same split the pages render. The balance file is `คลังทองคำแท่ง_<วันที่>.xlsx`;
the movement file carries its window, `ความเคลื่อนไหวทองแท่ง_<from>_ถึง_<to>.xlsx`.

**Generated in the browser from the data already loaded.** No export endpoint, no second request:
the builders take the rows the table is rendering, so the file cannot disagree with the screen, and
`splitByPurity()` / `withCumulative()` stay the single implementation of the purity split and the
running balance. `write-excel-file` is pulled in with a dynamic `import()` inside the click handler,
so its ~50 KB lands in its own chunk and only someone who exports pays for it.

- **A figure goes into a cell as a number, never as a formatted string.** `formatNumber()` and
  `formatWeight()` are for the screen; their output is text to Excel and a column of it cannot be
  summed, which is the first thing anyone does with an exported ledger. Presentation is a cell
  *format* — `#,##0.00` for money, `#,##0.####` for weight, and `+#,##0.00;-#,##0.00` for deltas,
  which is how the ledger keeps the explicit sign the screen shows.
- **Dates are Thai พ.ศ. text**, exactly as `formatBusinessDate()` renders them. Excel cannot put a
  Buddhist-era year on a real date value, so this is the deliberate trade: text that reads right
  and does not sort. Rows therefore stay in the API's ascending `(movementDate, movedAt, id)`
  order — chronology comes from the row order, and sorting that column would order it lexically.
- **Every sheet opens with a title block** (rows 1–3: report, window, generated-at + by) and freezes
  through the header. A file outlives the screen it came from and the date range is not recoverable
  from the rows. Nothing is merged — merged cells break sorting and filtering below them.
- **The movement sheets carry a `ยอดยกมา` row** holding `sectionOpening()` — the window's carried-in
  balance, per section, in that section's unit. Without it the `คงเหลือสะสม` column starts at a
  number the reader cannot derive from anything else in the file. It is emitted even when the
  window is empty: "nothing moved, and here is what you were holding" is a complete answer.
- **Both sheets are always written, empty or not.** A workbook missing `ทอง 99.9%` reads as a broken
  export rather than as a purity nobody holds today.
- The builders are pure — rows in, cell arrays out — and tested in `inventoryExport.test.ts` with no
  master data and no library. `downloadWorkbook()` is the only part that touches `write-excel-file`.
- Export is offered to any authenticated operator, matching `GET /inventory/volume|movements`. Cost
  and WAC are already on screen, so the file exposes nothing the page does not.

**No range cap.** The window operators actually use is a week to a month, rarely three, which is a
few thousand rows — well inside what the browser serializes in under a second, and the unvirtualized
`TableRow` rendering is the real ceiling long before the export is. Serialization is synchronous,
so the button disables itself and shows a spinner while it runs.

## 10. Current State

The web app is a **scaffold**. Only one component exists (`UserList.tsx` — a user CRUD demo).

**Sprint 1 scope — auth + manual inventory tracking only:**

```
① Login screen — email + password → JWT → protected routes
② Inventory balance view — pool totals (purity / brand-or-origin / product type / weight / WAC)
③ Manual adjustment forms — stock gain, stock loss, product switch
④ Daily snapshot trigger — "Compute Today's Rate" button → POST /inventory/snapshots/compute
```

Transaction entry screens (wholesale, retail, receive), the management dashboard, and period reports are all deferred to Sprint 2+.

---

_GoldOffice · Web Context · 2026-06-14 · Root context: `../../CONTEXT.md`_
