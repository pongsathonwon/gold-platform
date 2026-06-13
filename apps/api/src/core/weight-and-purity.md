# Weight & Purity Decision Record

**Date:** 2026-06-13

---

## Context

The system trades gold bars. Two purities exist: **96.5** and **99.9**. They differ in how
weight is measured at the counter, which determines which unit the caller supplies and
which is computed by the server.

---

## Decision

### Weight unit is a property of purity, not the product type or the caller

The `purities` table carries a `unitOfMeasure` column (`'g' | 'gb'`). The value is set
when a purity record is seeded and never changes at runtime.

| Purity | unitOfMeasure | Caller supplies | Server computes |
|--------|--------------|-----------------|-----------------|
| 99.9   | `g`          | `weight` in grams (gm) | `weightGb = weightGm / conversionFactor` |
| 96.5   | `gb`         | `weight` in baht-weight (gb) | `weightGm = weightGb * conversionFactor` |

### Single `weight` field on every createTransaction request

`weightGb`, `weightGm`, and `conversionFactor` are **removed from all inbound request
shapes**. Callers send one field: `weight: number`. The server resolves all three stored
values automatically at creation time.

Both `weightGb` and `weightGm` are still stored as a snapshot on the transaction row.
`conversionFactor` is also snapshotted. Nothing about the stored schema changes.

### conversionFactor is auto-resolved from unit_conversions

On every `createTransaction`, the server fetches the row with the latest `effectiveDate`
from `unit_conversions`. The caller no longer supplies this value.

### Implementation

`infrastructure/weight.ts` — `resolveWeights(purityId, weight)` Effect:
1. Look up purity by id → read `unitOfMeasure`
2. Fetch latest `conversionFactor` from `unit_conversions ORDER BY effectiveDate`
3. Compute and return `{ weightGb, weightGm, conversionFactor }`

Error cases surfaced as typed domain errors (mapped in each routes' `toHttpError`):
- `PurityNotFoundError` → 422
- `NoConversionRateError` → 503

---

## Future scope

### Gold plate / gold leaf (possible addition)
Always 96.5 purity → `unitOfMeasure = 'gb'`. No code change needed; just seed the
purity record with the correct unit.

### Jewelry gold (later, separate domain)
Uses discrete bar sizes (0.25, 0.5, 0.75, 1, 2, 3 baht) rather than a continuous weight
field. This is a different request shape entirely and will be its own domain when added.
The `bar_sizes` table already exists for this purpose. No attempt to unify with the
current continuous-weight model.

---

## What was explicitly rejected

- **Caller-supplied `conversionFactor`**: removed because callers could pass stale or
  wrong values, silently corrupting `weightGm` and `totalAmount`.
- **Caller-supplied `weightUnit` flag**: rejected because the server cannot validate it
  matches the actual purity without a DB lookup anyway, so the flag adds no value.
- **Product-type-level unit**: rejected because two products (gold bar, gold plate) share
  96.5 purity and the same unit — the invariant belongs on purity, not product type.
