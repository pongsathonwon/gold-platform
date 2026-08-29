# Plan — ตั้งค่าระบบ (Settings) Pages

**Status:** proposed, not started
**Branch:** `dev`
**Follows:** `f95e1ab` `[inventory] open the movement ledger on yesterday as well as today`

---

## Why

Every row of master data in this system was put there by hand, in SQL. There is no `POST` or
`PATCH` on any of the six master-data routers — `suppliers`, `product-types`, `brands`,
`purity-grades`, `bar-sizes`, `branches` are read-only end to end. Adding a supplier means opening
`db:studio`.

That was fine while the seed data was the only data. It stops being fine the first time BU signs a
new supplier, because a supplier is not one row: it is a `suppliers` row plus its
`supplier_product_types` rows plus its `suppler_brands` rows, and **the last of those decides what
the brand split asks the operator for at `STOCKED` and `PACKED`**. Getting it wrong by hand puts
weight in the wrong inventory pool.

Users are the same shape of problem from the other end. There is no way to create an account except
`POST /auth/register`, which is **public and unauthenticated**, and no way to retire one except a
hard `DELETE` that orphans every `createdBy` / `recordedBy` / `movedBy` string the person ever
stamped on a transaction.

## Scope

**Phase 1 is suppliers and users.** Both are things that change because the business changed. The
flat lookup tables (brands, product types, bar sizes, branches) and `product_type_purities` are
go-live configuration that has not needed to change yet — they are Phase 2, and the section is built
so they slot in as tabs.

**`unit_conversions` is out of scope entirely**, not deferred to Phase 2 — see the note at the end.

**No RBAC.** Three teams and one manager with routine cross-duty; a role column would encode a
separation that does not exist on the floor and would be worked around within a week. Access is
"logged in", enforced consistently — which is itself a change, see below.

**Nothing is ever deleted.** Every master table already carries `active`; suppliers, brands and
product types are referenced by FK from transaction tables that must stay readable forever.
`users` gets the same treatment via a new column.

**IDs are never editable.** `productTypes.id`, `brands.id`, `purities.id`, `barSizes.id` and
`branches.branchCode` are varchar primary keys referenced across every transaction schema. They are
create-time only, on every entity, in every phase.

---

## What already exists

| Piece | State |
|---|---|
| `GET /master-data/*` — all six routers | done |
| `GET /master-data/suppliers/:id/product-types` and `/brands` | done |
| `suppliers`, `supplier_product_types`, `suppler_brands` tables | done |
| Write side of master data — repo, usecase, port, routes, schemas | **none of it exists** |
| `GET /users`, `GET /users/:id`, `DELETE /users/:id` | done (delete is wrong — see below) |
| `POST /auth/register` + `HashService` | done, but public |
| `users.active` column | **does not exist** |
| `authMiddleware` | exists; mounted on inventory + both wholesale routers only |
| `useSuppliers()` etc. in `hooks/useMasterData.ts` | read hooks done, no mutation hooks |
| Supplier picker filtering on `active` | already correct (`WholesaleBuyCreatePage.tsx:82`) |
| Web client attaching the JWT to every request | done (`api/client.ts`) |

The read side and the auth plumbing are finished. This is a write-side build on the API plus a new
web section.

---

## Design

### Section, routes and naming

One nav entry, `ตั้งค่าระบบ` → `/settings`, using the same vertical-tab shell as
`InventoryLayout.tsx`.

```
/settings
  ├── /settings/suppliers            ผู้ขายส่ง/ผู้รับซื้อส่ง   list
  ├── /settings/suppliers/new                                 create
  ├── /settings/suppliers/:id                                 edit
  └── /settings/users                ผู้ใช้งาน                 list + inline create
```

Phase 2 adds `ประเภทสินค้า`, `ยี่ห้อทอง`, `ความบริสุทธิ์`, `ขนาดแท่ง`, `สาขา` as sibling tabs with no
structural change.

Suppliers get their own create/edit **pages** rather than a dialog, because a supplier is three
tables and the brand set needs room. Users stay a single page — name, username, password, active is
a four-field form.

### Access: close the two open routers

`/master-data` and `/users` are currently mounted in `index.ts` with **no middleware at all**. They
are readable and, once this plan lands, would be writable by anyone who can reach the port.

```ts
.route("/auth", authRouter)
.use("/users/*", authMiddleware)
.use("/master-data/*", authMiddleware)
```

This is not RBAC — it is the same `authMiddleware` the inventory and wholesale routers already use.
The web client attaches the token to every request, so no frontend change is needed and no existing
screen breaks.

`POST /auth/register` moves behind the same gate, or is removed in favour of `POST /users`. Public
self-registration into a gold trading system is a defect independent of this feature; with no roles,
"you must already have an account to create one" is the whole control.

### Suppliers — the four server-side invariants

Endpoints, added to `supplier.routes.ts`:

| Route | Body |
|---|---|
| `POST /master-data/suppliers` | `supplierName`, `brandLock`, `productTypeIds[]`, `brandIds[]` |
| `PATCH /master-data/suppliers/:id` | any of the above, plus `active` |

No `DELETE`. The join sets are replace-in-full inside one DB transaction — a supplier's registered
brands are a set, and diffing them client-side would let a half-applied update through.

The port is named `ForViewSupplier`. Writes go in a sibling `ForManageSupplier` port with its own
`Layer`, rather than widening the existing interface — the read path is consumed by every
transaction domain and should not grow a write surface it never calls.

Four rules the UI must not be the only thing enforcing:

1. **`brandLock = true` requires exactly one registered brand.** `resolveBrandSplit()` gives that
   supplier's single brand 100% of the weight and refuses a caller-supplied split. Register zero
   brands and the split resolves to nothing; register two and it silently picks one. Both put gold
   in the wrong pool with no error anywhere. → `BrandLockRequiresExactlyOneBrandError` → 422.

2. **`NA` can never be a registered supplier brand.** It is the residual pool, taken by
   *subtraction* — "the split always sums to the transaction weight, by construction". Registering
   it makes it an enterable line and the residual gets counted twice. `findSupplierBrands` filters
   `brands.active = true` and `NA` is seeded `active=false`, so it is invisible today by accident;
   the write path should refuse it on purpose. → 422.

3. **A registered product type must be `supplierTradeable`.** รูปพรรณ is not something a supplier
   ships. The flag is configurable rather than hard-coded, so this is checked against its current
   value at write time and not baked into a constant.

4. **Deactivating is not deleting.** `active = false` removes a supplier from the pickers — already
   correctly filtered — and changes nothing about the transactions that reference it. The edit page
   should say so, because "delete" is what an operator will be looking for.

### Users — the migration is the point

`users` is `id, name, username, passwordHash, createdAt`. Two changes:

**Add `active boolean not null default true`.** Then:

- `DELETE /users/:id` is **removed**, not kept alongside. `createdBy` / `recordedBy` / `movedBy` /
  `auditedBy` are plain varchars holding a username (API CLAUDE.md open item #1) — deleting the row
  leaves those strings pointing at nothing, and the audit trail is the only record of who did what.
- `POST /users` — `name`, `username`, `password`, reusing `HashService` and the duplicate-username
  path `AuthUseCase.register` already has.
- `PATCH /users/:id` — `name` and `active` only. **No password field**, see below.
- **`login` must check `active`.** This is the half that makes the feature real: without it,
  deactivating a user changes a boolean and they keep logging in. `InvalidCredentialsError` on an
  inactive account, not a distinct error — a login screen should not confirm which usernames exist.

### Passwords are their own actions, and they re-authenticate

A password change is not a profile edit. Hanging an optional `password` on `PATCH /users/:id` means
an empty string can hash and set itself during a name edit; a required field on its own endpoint
cannot have that bug. Two endpoints, because the two cases have different actors:

| Route | Body | Who |
|---|---|---|
| `POST /users/me/password` | `currentPassword`, `newPassword` | anyone, for themselves |
| `POST /users/:id/password-reset` | `actorPassword`, `newPassword` | anyone, for someone else |

**Both re-authenticate the person at the keyboard.** With no roles, every logged-in session can
otherwise silently take over any account including the manager's — an unattended browser is the
whole attack. Confirming with your own password is not a role and encodes nothing about who reports
to whom; it just proves the session is being driven by the person it was issued to. It keeps the
colleague-helps-a-colleague reset that cross-duty actually needs, which is why this is not solved by
locking resets to an admin who may be on leave.

Wrong `actorPassword` / `currentPassword` → `InvalidCredentialsError` → 401, reusing the existing
error. Neither endpoint returns a token or touches the session.

**Not in this plan: `users.id` `serial` → `uuid`** (open item #4). It should happen before any FK
points at this table, and user management is what makes those FKs worth adding — but bundling a PK
migration into a feature build is how a feature build becomes a weekend. Flagging it as the next
thing, not this thing.

### Two bits of existing scaffolding to clear

- **`createUserSchema` in `packages/types/src/index.ts:4`** is dead mock scaffolding — it validates
  `name` + `email`, and there is no email column. It also occupies exactly the name the real schema
  wants. Delete it and `updateUserSchema` with it.
- **`FieldConfig.kind` has no boolean.** It is `select | number | text | multiline | date` over a
  `Record<string, string>`, and both `brandLock` and `active` are booleans. Add a `"switch"` kind to
  `DynamicFormField` storing `"true"` / `"false"`, rather than faking it with a ใช่/ไม่ใช่ select —
  Phase 2 is five more tables whose only editable field is `active`.

---

## Work breakdown

**packages/types**
1. Delete the mock `createUserSchema` / `updateUserSchema`; add `createSupplierSchema`,
   `updateSupplierSchema`, `createUserSchema`, `updateUserSchema`, `changePasswordSchema`,
   `resetPasswordSchema` (real ones).

**API**
2. Migration: `users.active`.
3. `ForManageSupplier` port + errors; repository writes with the join-set replace in one
   transaction; usecase; `POST`/`PATCH` on `supplier.routes.ts`.
4. User usecase/repo: `create`, `update` (name + active only), drop `deleteById`; `active` check in
   `login`.
5. `POST /users/me/password` and `POST /users/:id/password-reset`, both verifying the actor's own
   password through `HashService` before writing.
6. `index.ts`: `authMiddleware` on `/master-data/*` and `/users/*`; gate or drop `/auth/register`.

**Web**
7. `"switch"` kind in `DynamicFormField` + `FieldConfig`.
8. `SettingsLayout` + nav entry + routes in `App.tsx`.
9. `useMasterDataMutations.ts`, `useUsers.ts` / `useUserMutations.ts` with `master-data` / `users`
   cache invalidation.
10. `SupplierListPage`, `SupplierFormPage` (create + edit, one component), `UserListPage` with the
    two password dialogs.

**Verification**
11. `pnpm type-check`; usecase tests for the four supplier invariants, the inactive-login path, and
    both password endpoints rejecting a wrong actor password; drive the app — create a supplier,
    use it on a wholesale-buy through `STOCKED`, confirm the brand split offers exactly its
    registered brands.

---

---

## `unit_conversions` — out of scope, and staying that way

**No screen, in any phase, until this note is revisited.** The GB↔gram factor drives every weight
conversion in the system and `scripts/seed.ts:58` remains its only writer.

Two things found while scoping it, recorded so the next person does not have to find them again:

- **`resolveWeights` ignores `effectiveDate`.** `infrastructure/weight.ts:30-33` takes the row with
  the *highest* date (`.at(-1)`), never comparing it to today, so a future-dated row would take
  effect the moment it is inserted. **Unreachable while nothing writes to the table** — which is
  precisely why no UI is the safe position. Anyone adding one must first change the query to
  `WHERE effectiveDate <= today ORDER BY effectiveDate DESC LIMIT 1`.
- **`changeBy` cannot hold a user id.** It is `uuid()`; `users.id` is `serial`. Open item #4,
  somewhere concrete.

If the table ever does need writing, it is append-only: `effectiveDate` + `changeBy` describe a
history, every transaction snapshots `conversionFactor` at creation (CONTEXT.md rule 10), and the
action is "record a new factor", never "edit the factor". No `PATCH`, ever.
