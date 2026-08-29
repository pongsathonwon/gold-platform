# Plan — Wholesale Edit Form

**Status:** proposed, not started
**Branch:** `dev`
**Follows:** `fdb8314` `[transactions] record the business date beside the insert timestamp`

---

## Why

`PATCH /wholesale-buy/:id` and `/wholesale-sell/:id` accept every field a `CREATED` transaction can
still change — supplier, product type, purity, weight, price, notes, and now `transactionDate` —
and re-derive the settlement period when the date moves. **Nothing in the UI reaches any of it.**
Routes are `/new` and `/:id` only.

So an operator who picks the wrong date, or fat-fingers a weight, has to delete and re-enter. That
was tolerable while the only wrong values were typos. It is not tolerable now that the date is
pickable and decides which week the order counts in: getting it wrong is both easy and consequential.

## Scope

**The full editable set, not just the date.** The API already supports every field, the guard
(`CREATED` only) is one rule for all of them, and a date-only editor would be a strange thing to
explain to an operator who can see the weight is also wrong. One form, one guard, one mental model.

Both domains. wholesale-sell is a deliberate mirror of buy and diverging them here would be new
debt, not saved work.

---

## What already exists

| Piece | State |
|---|---|
| `PATCH` route + `updateTransaction` usecase, both domains | done, tested |
| `updateWholeBuySchema` / `updateWholeSellSchema` (`.partial()` of create) | done |
| `useUpdateWholesaleBuy(id)` / `useUpdateWholesaleSell(id)` | **written, called from nowhere** |
| Cache invalidation on those hooks | done (`wholesale-*` + `inventory`) |
| API-side re-derivation of `settlementPeriod` on a date change | done, tested |
| API-side `NotEditableError` → 422 after `CREATED` | done, tested |

The backend and the data layer are finished. This is a UI-only change plus one shared-helper
extraction.

---

## Design

### Route and entry point

`/wholesale-buy/:id/edit` and `/wholesale-sell/:id/edit` — a page, not a dialog. The detail page's
dialog is already carrying the status-transition flow with its per-move extra field; adding a
seven-field form to it would overload one component with two unrelated jobs.

Entry: an `แก้ไข` button on the detail page, rendered only when `currentStatus === "CREATED"` —
the same conditional the `ยืนยันอัตโนมัติ` row already uses.

### Extract the field config before writing the second consumer

`WholesaleBuyCreatePage` and `WholesaleSellCreatePage` already carry near-identical ~90-line
`fields` arrays (same labels except ผู้ขายส่ง/ผู้รับซื้อส่ง, same purity-rule lookup, same weight
unit resolution, same price helper text, same `RESET_ON_CHANGE` map). Two edit pages would make
that **four** copies of the same rules, and the copies would drift — the create forms would gain a
field the edit forms silently lack.

Extract to `src/forms/wholesaleFields.ts`:

```ts
buildWholesaleFields({ role, suppliers, productTypes, purityRules })
  → FieldConfig<WholesaleValues>[]
```

`role: "buy" | "sell"` picks the counterparty label. All four pages consume it. This is the only
refactor in the plan and it pays for itself on the second call site.

### Prefill — two traps

**1. Weight must be re-expressed in the pairing's input unit.** For a kg pairing the stored
`weightGb` is *not* what the operator typed: a 2 kg order is stored as ~131.2 GB. Prefilling the
form from `weightGb` and submitting would rescale it silently.

The server already guards this exact case in `updateTransaction`:

```ts
const storedWeightInInputUnit =
    rule.inputUnit === 'kg' ? transaction.weightGm / 1000 : transaction.weightGb;
```

The form needs the mirror. Extract it as a pure helper so both sides state the rule once and it can
be tested without a component.

**2. `useDynamicForm` snapshots `initialValues` on first render** (`useState(initialValues)`) and
will not re-initialise when a query resolves later. `useProductTypePurities(productTypeId)` is a
*dependent* query — it cannot start until the transaction has loaded — so a form rendered eagerly
would build its initial values against an empty rules list, resolve `inputUnit` to the `gb` default,
and prefill a kg order in the wrong unit. Trap 1 arrives through the back door.

**Gate rendering on both queries being settled.** Show the spinner until the transaction *and* its
purity rules are in hand, then mount the form once with correct values. Do not "fix" this by adding
a reset effect to `useDynamicForm` — that makes every form in the app re-initialisable and invites
clobbering a half-typed edit when a background refetch lands.

### Submit a diff, not the whole form

`updateWholeBuySchema` is `.partial()`, so send only fields whose value actually changed.

Not just tidiness: the server recomputes weights, `conversionFactor` and `totalAmount` whenever
*any* of weight/purity/productType/price is present in the request. `conversionFactor` is
snapshotted at creation on purpose (CONTEXT.md rule 10) so historical records stay accurate if the
master rate changes. Submitting an unchanged weight alongside a notes edit would re-snapshot it
against today's `unit_conversions` row — quietly rewriting a value the system promises not to touch.

A diff also makes "changed nothing, pressed save" a no-op instead of a write.

### The confirmation race

The nightly sweep (or an operator's mid-day `confirm-all`) can confirm the transaction between page
load and submit. The server answers 422 `transaction … is no longer editable`. The form should
surface that message as-is and refetch, so the page stops offering an edit that can no longer land.
No optimistic handling, no retry — the answer is correct and final.

---

## Tasks

- [ ] **1. `src/forms/wholesaleFields.ts`** — extract the shared field config; both create pages
      switch to it and lose their local arrays. No behaviour change; existing pages must render
      identically.
- [ ] **2. `src/utils/wholesaleWeight.ts`** — `storedWeightInInputUnit(transaction, rule)` and
      `changedFields(initial, current)`. Pure functions, no React.
- [ ] **3. `WholesaleBuyEditPage.tsx`** — gated load, prefill via (2), shared fields via (1),
      `useUpdateWholesaleBuy`, toast + navigate back to the detail page on success, 422 surfaced
      inline.
- [ ] **4. `WholesaleSellEditPage.tsx`** — the mirror.
- [ ] **5. Routes + entry points** — two routes in `App.tsx`; `แก้ไข` button on both detail pages,
      `CREATED` only.
- [ ] **6. Tests** — vitest over the two pure helpers: kg vs gb prefill (the 2 kg order must come
      back as `2`), diff builder (unchanged → `{}`, notes-only → `{notes}`, date-only → `{transactionDate}`),
      and that an unchanged weight never appears in a payload.
- [ ] **7. Docs** — `apps/web/CLAUDE.md` §9b/§9c gain the edit page; note that the field config is
      shared and must not be re-inlined.

---

## Verification

- `pnpm type-check`, `pnpm test`, `pnpm build`.
- Live, per domain:
  - Edit `transactionDate` on a `CREATED` order → detail page shows the new date, **`งวดชำระ` moves
    with it**, and the list re-sorts.
  - Edit weight on a **99.9% kg** order → the form opens showing `2`, not `131.2`; saving unchanged
    leaves `weightGm` byte-identical.
  - Edit notes only → `conversionFactor` unchanged in the database (the diff rule, checked directly).
  - Confirm the order, then submit a stale edit form → 422 surfaced, nothing written.
  - `แก้ไข` absent on any non-`CREATED` transaction.

---

## Out of scope

- **Product switch has no picked date** — same three-line change as gain/loss, unrelated to editing.
- **retail-buy / retail-sell / receive** still take `settlementPeriod` from the caller and have no
  `transactionDate`; they need both migrations together, and they have no UI at all yet.
- **Delete / void.** Terminal transactions are never reopened and `CREATED` ones exit via
  `CANCELLED`, which the status flow already handles. Editing is not a route to deletion.
- Editing anything after `CREATED`. Confirmation is the lock; corrections past it go through the
  inventory gain/loss forms, as documented.
