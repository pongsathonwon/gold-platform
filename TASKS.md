# Sprint 1 — Auth + Manual Inventory Tracking

**Scope:** Login/auth flow and inventory balance model overhaul with manual management endpoints and their frontend.  
Transaction domains (wholesale, retail, receive, smelting, convert-out) are Sprint 2+.

---

## Backend

See [apps/api/TASKS.md](apps/api/TASKS.md) for the full breakdown.

- [x] Schema: replace `inventoryLots` with `inventoryBalance`; add `origin`, `notes`, `productSwitchAdjustments`
- [x] Inventory domain: WAC via daily snapshot, `computeSnapshots`, `productSwitch`
- [x] Auth: login endpoint working, JWT middleware on inventory routes
- [x] DB migration + seed `'NA'` brand

## Frontend

See [apps/web/TASKS.md](apps/web/TASKS.md) for the full breakdown.

- [x] Login screen + JWT storage + auth guard
- [x] Inventory balance view + today's WAC rate display
- [x] Manual adjustment forms (gain, loss, product switch)
- [x] Daily snapshot trigger button

---

## Definition of Done

- Login issues JWT; protected routes reject requests without a valid token
- `POST /inventory/snapshots/compute` freezes WAC rate; subsequent `decrement()` calls use it
- `POST /inventory/gain` and `POST /inventory/loss` update `inventoryBalance` atomically
- `POST /inventory/product-switch` atomically moves weight from non-fungible pool to fungible pool
- `GET /inventory/volume` reflects real balance table state
- Inventory balance UI shows pool totals and today's WAC per pool
- `pnpm type-check` passes across all packages
- DB migration applies cleanly from scratch on a fresh Postgres instance

---

# V1 Inventory Feedback (post-launch)

Tracking checklist for the approved plan (`~/.claude/plans/the-v1-of-this-temporal-cherny.md`).
Update this file (mark done + notes) before moving to the next task.

- [x] **1. packages/types** — `pricePerGb` on gain schema, `TRANSACTION_TYPES` + `transactionTypeSchema`, swap `reason`→`referenceType` on both schemas. _Done: added `TRANSACTION_TYPES` (bilingual), `transactionTypeSchema`, `TransactionType`; gain now takes `pricePerGb` + `referenceType`, loss takes `referenceType`._
- [x] **2. inventory.schema.ts** — add `pricePerGb`, change `reason`→`referenceType` varchar, drop reason pgEnums; `db:generate` + `db:migrate`/reseed. _Done: schema updated; hand-authored migration `drizzle/0004_flat_referral.sql` + `0004_snapshot.json` + journal entry (drizzle-kit generate needs a TTY to resolve the rename, unavailable here). **Postgres is down (5432 closed) — run `npm run db:migrate` in apps/api when the DB is up; reseed if adjustment tables have rows (new NOT NULL cols have no default).**_
- [x] **3. Backend usecase/repository** — gain `totalCost = pricePerGb × weightGb`; live-WAC `decrementBalance`; remove snapshot gate in `stockLoss`/`decrement`/`productSwitch`; set movement `referenceType` from request. _Done: `decrementBalance` now computes cost from the locked row's live WAC and returns it; `NoSnapshotError` removed from port/routes/usecase; productSwitch conserves value (`toCostDelta = fromCostDelta`); stockLoss decrements before writing the adjustment. API + types type-check clean._
- [x] **4. StockGainPage.tsx** — price-per-baht field + shared transaction-type dropdown. _Done: `pricePerGb` (ราคาต่อบาททอง) replaces Total Cost; `referenceType` select uses `TRANSACTION_TYPES`._
- [x] **5. StockLossPage.tsx** — shared transaction-type dropdown (no price). _Done: `referenceType` select uses `TRANSACTION_TYPES`; no price field._
- [x] **6. InventoryPage.tsx** — split 96.5 (GB) / 99.9 (KG) sections + per-purity total row. _Done: two `ทอง 96.5%` / `ทอง 99.9%` sections; 96.5 shows GB, 99.9 shows KG (grams/1000); each has a bold `รวม` footer summing weight + cost._
- [x] **7. InventoryMovementPage.tsx** — split sections + per-purity total row. _Done: same two-section split with signed/coloured deltas and a `รวม` footer per purity._
- [~] **8. Type-check both apps** + run the Verification flow. _Type-check PASSES for `packages/types`, `apps/api`, `apps/web`. **Migration 0004 APPLIED** (Postgres via docker-compose): `price_per_gb`/`reference_type` NOT NULL added, `reason` cols + both pgEnums dropped, existing rows backfilled (price = total_cost/weight_gb; reason→referenceType mapped, e.g. stock_count→STOCK_COUNT). Remaining: drive the app for the plan's Verification steps 3–6 (needs `pnpm dev`)._

## V1 Feedback Notes

- Docs updated: `apps/api/CLAUDE.md` now describes live-WAC (report-only snapshots, `pricePerGb`, `TRANSACTION_TYPES`); open-item #9 marked resolved. `inventory.md` got a stale banner pointing to CLAUDE.md (it described a never-built lot/FIFO model).
- `getDailySnapshot` (repo/port) is retained but no longer used by any usecase — kept for the opening-balance report feature.

---

# Inventory Nav Sidebar (post-launch)

- [x] **1. InventoryLayout.tsx** — vertical `Tabs` sidebar (Inventory / Movement History / Stock Gain / Stock Loss / Product Switch) with active tab driven by `useLocation()`; nested `/inventory/*` routes under it in `App.tsx` (index route = `InventoryPage`). Replaces the per-page row of nav buttons.
- [x] **2. InventoryPage.tsx** — dropped the `% ทอง` table column (redundant with the `ทอง 96.5%` / `ทอง 99.9%` section titles); extracted the purity-split / weight-unit / WAC math into `src/utils/inventoryVolume.ts` (`poolKey`, `weightOf`, `wacRate`, `splitByPurity`).
- [x] **3. Test infra** — added `vitest` to `apps/web` (`npm test` → `vitest run`), config in `vite.config.ts`; unit tests for the extracted helpers in `src/utils/inventoryVolume.test.ts` (6 tests, gb/kg conversion, WAC divide-by-zero guard, purity split). Verified the sidebar + column removal live via a Playwright smoke script (`playwright` added as a dev dependency for reuse).

---

# InventoryMovementPage Polish (post-launch)

- [x] **1. InventoryMovementPage.tsx** — reference type now maps through `TRANSACTION_TYPES` Thai labels instead of the raw code; dropped the redundant `% ทอง` column (footer colspans adjusted); product type renders `Goldbar`→ทองแท่ง / `Gold Plate`→ทองแผ่น; cost delta uses the same success/error colour as weight and formats with thousands separators + sign (`+1,234.56`), including the `รวม` footer total.

---

# Stock Gain/Loss Form Cleanup (post-launch)

- [x] **1. packages/types** — tagged each `TRANSACTION_TYPES` entry with a `direction` (`gain` / `loss` / `both` / `none`, derived from which usecase — `increment` vs `decrement` — each domain calls per `apps/api/CLAUDE.md`); exported `GAIN_TRANSACTION_TYPES` / `LOSS_TRANSACTION_TYPES` filtered views. `PRODUCT_SWITCH` is `none` — it's set internally by the product-switch flow, never user-selected.
- [x] **2. StockGainPage.tsx / StockLossPage.tsx** — reference-type dropdown (and default value) now sources from the direction-filtered list instead of the full `TRANSACTION_TYPES`; dropped the "Audited By" field (already excluded from the submitted payload — was UI noise) and the now-unused `useAuth` import.
- [x] **3. Tests** — `apps/web/src/pages/transactionTypes.test.ts`: gain/loss lists only contain their allowed directions, each excludes the other's exclusive types and `PRODUCT_SWITCH`, and `both`-tagged types appear in both lists.

---

# Wholesale Buy Domain (2026-08-03)

Full build of the wholesale-buy (ซื้อส่ง) domain — one item per transaction, supplier + gold type +
purity + brand, dual purity pricing, and the `CREATED → CONFIRMED → PAID → RECEIVED → CHECKED`
status machine with its failure branches. Inventory increments on entering `CHECKED`.

**Decisions taken with the operator:**
- Bad paths: the full set — `CANCELLED`, `REJECTED`, `RETURNED`, `PAYMENT_FAILED`, `DISPUTED`.
- Quantity mismatch at check: capture the actual weight and increment what really arrived.
- Confirm: `CONFIRMED` stays a distinct status (legacy status 2) + an edit-window deadline + a cron
  endpoint. All three, not one or the other.
- Post-`CHECKED` corrections: existing stock-loss/gain forms, no `REVERSED` status.

- [x] **1. packages/types** — `WHOLE_BUY_STATUSES` (Thai labels, `kind`, `terminal`),
  `WHOLE_BUY_TRANSITIONS` (shared state machine), `derivePricePerGb999()`, create/update/advance/
  receive-check schemas. _The transition map is shared so the UI can only offer moves the API accepts._
- [x] **2. Schema + migration** — new 10-value `whole_buy_status` enum, `price_per_gb_999`,
  `actual_weight_gb/gm`, `actual_amount`, `confirm_due_at`, `notes`. `drizzle/0006_wholesale_buy_domain.sql`
  generated then hand-hardened (legacy `DRAFT→CREATED` / `SETTLED→CHECKED` remap, backfilled NOT NULL
  adds). **Applied to the local Postgres.**
- [x] **3. infrastructure** — new `settlement.ts` (`resolveSettlementPeriod`, Fri–Thu → ISO week);
  `quantity.ts` split into `resolveQuantity` (validated) + `resolveMeasuredQuantity` (as-weighed);
  `resolveWeights` now returns `unitOfMeasure` so callers can price per purity.
- [x] **4. Port + usecase + routes** — `createTransaction`, `updateTransaction` (edit window),
  `advanceStatus`, `receiveAndCheck`, `autoConfirmOverdue`, `getTransaction`, `listTransactions`.
  Routes now behind `authMiddleware`; actor comes from the JWT, `settlementPeriod` from the server.
- [x] **5. Web** — list / create / detail pages, `useWholesaleBuy*` hooks, `utils/wholeBuyStatus.ts`,
  routes + navbar link, `useSuppliers()` added to `useMasterData`.
- [x] **6. Seed** — two suppliers with fixed UUIDs (idempotent); the domain could not record
  anything without one.
- [x] **7. Verification** — type-check passes for all three packages; 28 web unit tests pass
  (10 new). Drove the live API end-to-end: happy path with a short delivery (12 GB ordered →
  11.95 GB checked → balance 60 → 71.95 GB, cost +576,587.50, exactly one movement row); 99.9%
  kg path priced off the 999 quote with the `NA` brand forced; auto-confirm job (0 then 1);
  `DISPUTED → RETURNED` left inventory untouched. Rejections verified: invalid transition, missing
  note, edit after window, cancel after payment, move from a terminal state, invalid purity/product
  pairing. Playwright smoke of all three pages: no console errors.

- [x] **8. List split by purity** — `WholesaleBuyListPage` now renders `ทอง 96.5%` (บาท) and
  `ทอง 99.9%` (กก.) sections with per-section `รวม` footers, matching InventoryPage. A 2 kg order
  reads `2.000 กก.` instead of its 131.20 gold-baht equivalent, and the list no longer contradicts
  the detail page. Dropped the now-redundant `% ทอง` column. `splitByPurity()` relaxed to be generic
  over the row shape so the wholesale-buy list reuses it. New `countsTowardTotal()` keeps
  cancelled/rejected/returned orders out of the totals (4 new tests, 32 web tests pass).

- [x] **9. Operator revisions (2026-08-03)** — six changes after reviewing the first cut:
  1. **One price on the create form.** `pricePerGb965` is the only input; `createWholeBuySchema` no
     longer accepts `pricePerGb999` and the server derives it. Two typed prices could disagree, a
     derived one cannot. The form previews the derived figure in helper text.
  2. **99.9% confirmed to land in `foreign`.** Already hardcoded; now asserted end-to-end and
     documented as a rule (only smelting makes domestic stock).
  3. **Acceptance is strictly all-or-nothing.** A delivered weight that is not exactly the ordered
     weight now diverts to `DISPUTED` with **nothing entering inventory**, instead of booking the
     actual weight at a pro-rated cost. `/status` and `/receive-check` return the status actually
     reached so the UI can say so. Equality is compared in the pairing's input unit, not GB, so a
     `conversionFactor` change cannot make identical kg figures compare unequal.
  4. **Confirmation is a nightly bulk sweep.** `POST /wholesale-buy/confirm-all` confirms *every*
     `CREATED` transaction (`BOT-CONFIRM`), with `?manual=true` as the operator's mid-day run,
     wired to a "ยืนยันทั้งหมด (n)" button on the list. The per-order edit window is gone: edits are
     allowed while `CREATED`, full stop, and `confirmDueAt` is now just when the next sweep lands
     (`WHOLESALE_BUY_AUTO_CONFIRM_HOUR`, default midnight).
  5. **Weights render as entered.** New `formatWeight()` — "2" not "2.000" — on both the list and
     detail pages; money keeps its two decimals.
  6. **Bug found while verifying:** a shipment disputed at 14 and then accepted at 15 kept showing
     the stale 14 as delivered. The recorded discrepancy is now cleared on acceptance, so a
     `CHECKED` transaction always matches its order; the `DISPUTED` log entry keeps the history.

  _Verified live: derived price 48,250 → 49,950; a mismatched receive-check landed on `DISPUTED`
  with 0 movements, then accepted at the ordered weight and moved the balance 71.95 → 86.95; a
  99.9% order booked to `foreign`/`NA`; nightly sweep confirmed 3 as `BOT-CONFIRM` and the manual
  run 1 as `admin`; edit after confirmation rejected. 36 web tests pass, all packages type-check._

## Follow-ups not done

- `GET /wholesale-buy/settlement/:period/summary` — belongs to the Phase 4 position work.
- The other transaction domains still take `settlementPeriod` from the caller; they should move onto
  `resolveSettlementPeriod` too.
- No scheduler is wired to `POST /wholesale-buy/confirm-all` — the endpoint and the manual button
  exist, the nightly cron does not. It also needs an identity to authenticate as; today any caller
  without `?manual=true` is logged as `BOT-CONFIRM` regardless of whose token was used.

---

# Movement Cumulative Balance (post-launch)

Tracking checklist for the approved plan (`~/.claude/plans/the-inventory-movements-page-user-clever-phoenix.md`).
Update this file (mark done + notes) before moving to the next task.

Running balance per purity (all brands mixed) on `/inventory/movements`, over a from–to date range (default today). Recompute-on-read from the append-only ledger — no stored `balanceAfter` column. Balance per line = per-purity opening (sum of deltas before `from`) + running sum forward through the window.

- [x] **1. Backend** — `from`/`to` on `movementsQuerySchema` + `MovementFilter`; `listMovements` gains `gte`/`lte` on `movedAt` and ascending `(movedAt, id)` order; new `sumMovementsBefore` per-purity opening (first SQL aggregate in the repo; `coalesce(sum(...),0)::double precision`, skipped when no `from`); `getInventoryMovements` returns `{ movements, opening }`. _Done: shared `nonDateConditions` helper reused by both queries so opening covers the same pools as the window._
- [x] **2. Frontend helper** — `withCumulative(rowsAsc, opening)` in `src/utils/inventoryVolume.ts` (per-`purityId` running total, seeds from opening, preserves input order) + 5 vitest cases in `inventoryVolume.test.ts` (opening seed, missing-opening=0, mixed-brand forward sum, independent purities, empty window). _Done: 18 web tests pass._
- [x] **3. InventoryMovementPage** — from/to `type="date"` inputs (default today, MUI v9 `slotProps`), `คงเหลือสะสม` balance column per section (gb for 96.5, gm/1000 for 99.9), closing-balance footer. _Done: rows render ascending (oldest→newest) per operator preference; closing balance = last row._
- [~] **4. Type-check both apps** + run the Verification flow. _Type-check PASSES for `apps/api` and `apps/web`; 18 web unit tests pass. **Live run blocked — Docker daemon down, Postgres 5432 closed.** Remaining: `docker compose up -d` + `pnpm dev`, then cross-check each section's closing balance (with `to = today`) against `SELECT purity_id, sum(total_weight_gb) FROM inventory_balance GROUP BY purity_id`._


---

# Retail Manual Entry (2026-08-24)

Manual write-up of retail buy and sell, so all four transaction domains can be compared on the one
question the business asks: **was the price we dealt at a good one?** POS integration stays deferred
— its sell-gold-bar document is unfinished — so this is how retail figures reach the system.

**Decisions taken with the operator:**
- **No inventory coupling on either side.** Stock stays manual via `/inventory/gain|loss`.
  Retail-sell's `SHIPPED` decrement was *removed*, not merely bypassed.
- **Operating fee lives beside `totalAmount`, added only when a consumer needs it.** `totalAmount`
  stays gold value alone so it is comparable against wholesale, which has no fees.
- **Operator picks the date, the server timestamps, and the period follows the picked date.**
- **`BAR` and `PLATE` only** — anything else lives in another system, so no jewellery product type.
- **Branch metadata**: `insertedAt` + `deletedAt`; the opening date was dropped as unused and
  unknown for the oldest thirteen branches.

- [x] **1. Migration `0017_retail_manual_entry`** — dropped the six POS-sync columns from both retail
  tables (they held zero rows), added `transaction_date` / `operation_fee` / `notes` / `source`, made
  `brand_id` nullable, moved the status default to `CONFIRMED`; `branches` gained `inserted_at` +
  `deleted_at`. Hand-authored following the 0016 precedent, journal entry added. **Applied.**
- [x] **2. packages/types** — `RETAIL_BUY/SELL_STATUSES`, `..._TRANSITIONS`, `..._NOTE_REQUIRED`,
  `..._EXCLUDED_FROM_TOTALS`, create/update/advance schemas. Both ports re-type the transition maps
  against the DB enum, so divergence is a compile error.
- [x] **3. API** — both domains rewritten: create lands on `CONFIRMED` with one status row,
  `transactionDate` defaults and drives `resolveSettlementPeriodOn`, weights via
  `resolveMeasuredQuantity` (not `resolveQuantity` — a counter weight is measured, so 3.7 GB is
  valid), actor from the JWT, note required on void, `from`/`to` list window sorted
  `(transactionDate DESC, recordedAt DESC)`. The retail-sell `decrement` import is gone.
- [x] **4. Seed** — 47 real branches from the shop's export, verified field-by-field. `branchCode` is
  the legacy numeric id and is **not** the G-number (branch 1 is G006, branch 6 is G001).
- [x] **5. Web** — `pages/retail/` (three shared components + a per-domain config, two exported
  component types per page so React remounts rather than reconciling), `utils/retailStatus.ts`,
  `hooks/useRetail*.ts`, `useBranches` + `liveBranches`, routes and two navbar links.
- [x] **6. Export** — `utils/wholesaleExport.ts` renamed to `transactionExport.ts`; one builder now
  serves all four domains via `RETAIL_BUY_REPORT` / `RETAIL_SELL_REPORT`. Retail passes
  `comparisonWeight*: null` and its fee never reaches the file.
- [x] **7. Tests** — 34 new API (create-on-`CONFIRMED`, period derivation, note enforcement, and that
  **no inventory usecase is called**), 21 new web. 96 API + 177 web pass; all packages type-check.
- [x] **8. Verification** — drove the live API and the running app. Backdated to Thu 20 Aug → period
  W33 while today → W34; weight 3.7 accepted; `totalAmount` 177,600 with the 500 fee outside it;
  `recordedBy` taken from the token despite a conflicting body field; `CONFIRMED → SHIPPED` 422; void
  without a note 422, with one 200; **`inventory_movements` unchanged at 3 throughout**. The
  retail-sell report over live data averaged 69,000 (1 GB @60k + 9 GB @70k) — weighted by weight,
  not the 65,000 mean of the prices — with the footer agreeing with the summary block.

## Follow-ups not done

- **POS sync.** `source` is the seam. A feed will also want a nullable document-number column to
  group multi-line receipts; one row is one line today.
- **Customer deposits** — custody, not a trade. Needs its own domain; must never be a retail-buy.
- **Shipping** on retail-sell, and the inventory decrement that would come back with it.
- **The combined four-domain position view** (Phase 4). The four per-domain xlsx exports are the
  interim answer. Note that no `settlement/:period/summary` endpoint exists on any domain, despite
  what the docs claimed before this change.
- **Money precision** — every `decimal` is unbounded and read as a JS float. Worth one pass across
  all domains rather than pinning it on the newest tables alone.
- `G099-ทดสอบ` is seeded active and will appear in the create-form branch dropdown; setting
  `deleted_at` hides it there while keeping it resolvable on historical rows.
