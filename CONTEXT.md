# GoldOffice Platform — Project Context

**Monorepo:** `gold-platform`  
**Branch:** `dev`  
**Last updated:** 2026-06-14

---

## 1. What This System Is

GoldOffice is a **retail gold trading operations system** for a Thai gold shop with HQ and multiple branches.

The business captures intraday price spreads: they buy gold from customers, watch the market, then place a covering supplier order. The spread is the profit. The system's primary job is to make the manager's **open gold exposure visible** so they know when and how much to order from suppliers.

**This is not an inventory warehouse system.** Inventory tracking is a side effect of the trading operation. The position/period-net view is the core deliverable the manager uses every day.

### Dual Revenue Strategy

| Strategy | Products | Margin Source | Inventory Goal |
|---|---|---|---|
| Spread capture | ทองแท่ง (gold bar) | 50–200 THB/GB spread | Minimise uncovered holding time |
| Margin capture | ทองแผ่น, รูปพรรณ | ค่าบล็อค ~100/GB; ค่าแรง+ค่ากำเน็จ ~1,000/GB | Deliberate hold for fee margin |

**หลอมทอง** (smelting) bridges Strategy 2 → Strategy 1 by converting low-liquidity jewellery gold into tradeable gold bar.

---

## 2. Monorepo Structure

```
gold-platform/
├── apps/
│   ├── api/          — Hono backend (Node.js)
│   └── web/          — React + Vite frontend
├── packages/
│   └── types/        — Shared Zod schemas (API validation + web forms)
├── package.json      — Root scripts via Turborepo
├── pnpm-workspace.yaml
└── turbo.json
```

**Tooling:** Turborepo + pnpm workspaces. Tasks fan out to all apps in dependency order (`build` respects `^build`).

**Workspace packages:**
- `@gold-platform/api` — exported as a type source; web imports `AppType` for the Hono RPC client
- `@gold-platform/types` — shared Zod schemas consumed by both API validation and web form validation
- `@gold-platform/web` — frontend app

### Root Commands

```bash
pnpm dev            # run all apps in parallel (turbo dev)
pnpm build          # build all apps in dependency order
pnpm type-check     # tsc --noEmit across all packages
pnpm db:generate    # drizzle-kit generate (runs in apps/api)
pnpm db:migrate     # drizzle-kit migrate (runs in apps/api)
pnpm db:studio      # drizzle-kit studio
pnpm docker:up      # docker compose up -d (postgres)
pnpm docker:down    # docker compose down
```

---

## 3. Domain Build Order

```
① Master Data  →  ② Inventory  →  ③ Trade / Transactions  →  ④ Position / Period Net  →  ⑤ หลอมทอง
```

**Current state (2026-06-14):**

| Phase | Domain | Status |
|---|---|---|
| ① | Master data routes | Complete |
| ② | Inventory (lots, FIFO, movements) | Complete |
| ③ | wholesale-buy, wholesale-sell, retail-buy, retail-sell, receive | Complete |
| ③ | smelting, convert-out | Planned |
| ④ | Position / Period Net | Not started |
| ⑤ | หลอมทอง | Not started |

---

## 4. Gold Domain Concepts

### Product Types

| Thai | English | Supplier Tradeable | Strategy |
|---|---|---|---|
| ทองแท่ง | Gold bar (≥ 5 GB) | YES — high liquidity | Close position same day |
| ทองแผ่น | Sheet/leaf gold (< 5 GB) | YES — medium liquidity | Hold for ค่าบล็อค margin; `supplierTradeable` flag is **configurable, never hard-coded** |
| รูปพรรณ | Jewellery gold | NO | Hold for ค่าแรง + ค่ากำเน็จ margin |

### Purity Grades — Never Interchangeable

| Purity | Label | Unit | Products |
|---|---|---|---|
| 96.5% | Standard Thai gold | Gold Baht (GB) | ทองแท่ง, ทองแผ่น, รูปพรรณ |
| 99.99% | Investment grade | Gram / kilogram | Investment bars (supplier side) |

These are **separate inventory pools**. Cross-purity operations are never allowed.

### Weight Rules

Callers always send a single `weight` field. The server resolves both units:

| `purity.unitOfMeasure` | Caller sends | Server computes |
|---|---|---|
| `gb` (96.5%) | Gold Baht | `weightGm = weightGb × conversionFactor` |
| `g` (99.99%) | Grams | `weightGb = weightGm / conversionFactor` |

`conversionFactor` (1 GB ≈ 15.244 g) is snapshotted at creation on every lot and transaction row. **Never recalculated at query time.**

### Brand Rules

Brand is a **required first-class field** on every gold record.

| Brand | Rule |
|---|---|
| ฮั่วเซ็งเฮ็ง | `nonFungible = true`. Cannot substitute for or with any other brand. |
| AU, Inter | Generic — fungible within same purity |
| HQ Smelted | System-assigned on หลอมทอง output only. Never user-selectable. |

### Bar Sizes

All four active: **5 GB, 10 GB, 20 GB, 50 GB**.  
Interchangeable within the same brand and purity for fulfilment (two 5 GB bars = one 10 GB order).  
`bar_size_id` is NULL for all 99.99% purity records and for รูปพรรณ.

---

## 5. Settlement Period Model

Every transaction belongs to exactly one **Fri 00:00 → Thu 23:59** period, assigned at recording time. Assignment is immutable.

`settlementPeriod` is auto-derived server-side from `recordedAt`. **Callers never supply it.** Format: ISO week string e.g. `"2026-W24"`.

### Period Net Calculation (Phase 4 — not yet built)

Three independent signed figures per period. Positive = company gained; negative = company gave out.

```
Net Cash (THB)        = Σ Cash IN  (from customers + suppliers)
                      − Σ Cash OUT (to customers + suppliers)

Net Gold 96.5% (GB)   = Σ GB received (from customers + suppliers)
                      − Σ GB given    (to customers + suppliers)

Net Gold 99.99% (g)   = Σ grams received − Σ grams given
```

**Net Cash and Net Gold are independent.** A week of heavy customer buying = negative Net Cash + positive Net Gold. Both correct simultaneously.

### What Counts / What Doesn't

| Transaction | Counts in |
|---|---|
| Customer sells gold TO company (retail-buy) | Net Customer Orders |
| Customer buys gold FROM company (retail-sell) | Net Customer Orders |
| Company buys FROM supplier (wholesale-buy) | Net Company Orders |
| Company sells TO supplier (wholesale-sell) | Net Company Orders |
| Branch ↔ HQ transfer (any direction) | **EXCLUDED — inventory only** |

### Period Report

One immutable row per Fri–Thu period. Rows never auto-sum. Each row shows Net Cash, Net Gold 96.5%, Net Gold 99.99% — disaggregatable by product type (ทองแท่ง / ทองแผ่น / รูปพรรณ).

**No carryover.** A supplier order in period 2 that covers a customer buy from period 1 counts in period 2. Period 1 is unchanged.

**Per-transaction P&L is out of scope** (SCOPE-002). Do not build it into the weekly net model.

---

## 6. Key Business Rules

1. **Gold Baht is the customer unit; grams/kg is the supplier unit.** Always store both. Never recalculate at query time.
2. **ฮั่วเซ็งเฮ็ง is non-fungible.** Cannot substitute for or with any other brand, ever.
3. **96.5% and 99.99% are separate inventory pools.** Never mix in any query, pick, or calculation.
4. **`supplierTradeable` is configurable, not hard-coded.** ทองแผ่น may become tradeable in future.
5. **Cost basis must flow at actual transaction cost.** Market price is a valuation input only — never a cost entry.
6. **Bar sizes are interchangeable within the same brand.** Two 5 GB = one 10 GB. Brand segregation still applies.
7. **Inventory and position are decoupled.** A retail-buy feeds position (period net). It does not touch HQ inventory.
8. **Period assignment is immutable.** Transactions cannot be reassigned after posting.
9. **Internal transfers are excluded from period net.** They are inventory-only events.
10. **`conversionFactor` is snapshotted at creation.** Historical records stay accurate if the master rate changes.
11. **`gold_market_price` is never cached.** Always query live: `ORDER BY recorded_at DESC LIMIT 1`.
12. **Per-transaction P&L is out of scope.** SCOPE-002. Do not build it into the weekly net model.

---

## 7. Open Decisions (Pending Stakeholder)

| ID | Question | Blocks |
|---|---|---|
| D-07 | Are ค่าแรง / ค่ากำเน็จ fixed rates or negotiated per piece? | Whether app prompts fee override at transaction time |
| H-01 | Is the 1.036 purity price factor stable or variable (daily manual entry)? | `purity_price_factor` table design |
| D-POS | Paper contracts: position dashboard or separate fulfilment screen? | UI placement |
| D-01 | Branch recording: real-time POS vs batch upload? | Period net completeness intraday |

---

## 8. Glossary

| Term | Meaning |
|---|---|
| GB / Gold Baht | Thai weight unit. 1 GB ≈ 15.244 g (locked master data) |
| Open position | Gold bought from customers not yet covered by a supplier purchase |
| Net Customer Orders | Sum of all customer-facing gold transactions in a period |
| Net Company Orders | Sum of all supplier-facing gold transactions in a period |
| settlementPeriod | Fri–Thu week ID e.g. `"2026-W24"`. Auto-derived, never caller-supplied |
| Lot | Virtual accounting bucket for a batch of gold. Anonymous weight pool |
| FIFO | Oldest lot consumed first on all outbound movements |
| WAC | Weighted average cost = `total_cost / total_weight_gb` across active lots |
| ค่าบล็อค | Mould/block fee on ทองแผ่น — ~100 THB/GB |
| ค่าแรง + ค่ากำเน็จ | Labour + craftsmanship fees on รูปพรรณ — ~1,000 THB/GB total |
| หลอมทอง | Gold smelting — converts รูปพรรณ into ทองแท่ง |
| Paper contract | Large customer buy order at fixed price when branch has insufficient stock |
| Period | One Fri–Thu week. Unit of measurement for the management dashboard |

---

*GoldOffice · Root Context · 2026-06-14 · See `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md` for app-specific context*
