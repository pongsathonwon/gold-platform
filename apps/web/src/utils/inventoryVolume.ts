export type VolumeRow = {
  purityId: string;
  brandId: string;
  origin: string;
  productTypeId: string;
  totalWeightGb: number;
  totalWeightGm: number;
  totalCost: number;
};

export function poolKey(row: { purityId: string; brandId: string; origin: string; productTypeId: string }) {
  return `${row.purityId}-${row.brandId}-${row.origin}-${row.productTypeId}`;
}

// 96.5% is measured in gold baht (บาท); 99.9% in kilograms (กก. = grams / 1000)
export function weightOf(row: VolumeRow, unit: "gb" | "kg") {
  return unit === "gb" ? row.totalWeightGb : row.totalWeightGm / 1000;
}

// Generic over the row shape — the 96.5/99.9 split is a presentation rule shared by the inventory
// pages and the wholesale-buy list, and only the caller's predicate knows how to read the purity.
export function splitByPurity<T>(
  rows: T[],
  isNineNineNine: (row: T) => boolean,
): { nineSixFive: T[]; nineNineNine: T[] } {
  return {
    nineSixFive: rows.filter((r) => !isNineNineNine(r)),
    nineNineNine: rows.filter(isNineNineNine),
  };
}

export function wacRate(row: VolumeRow) {
  return row.totalWeightGb > 0 ? row.totalCost / row.totalWeightGb : 0;
}

// per-purity opening balance (sum of deltas strictly before the window's start date)
export type MovementOpening = { purityId: string; weightGb: number; weightGm: number };

type MovementDelta = { purityId: string; weightGbDelta: number; weightGmDelta: number };
export type WithCumulative<T> = T & { cumulativeWeightGb: number; cumulativeWeightGm: number };

// Runs a per-purity forward cumulative over movements ordered ascending by time, seeded from
// each purity's opening balance. Cumulative is the running balance *after* each line — mixing all
// brands within a purity. Input order is preserved; callers reverse for newest-first display.
export function withCumulative<T extends MovementDelta>(
  rowsAsc: T[],
  opening: MovementOpening[],
): WithCumulative<T>[] {
  const runningGb = new Map(opening.map((o) => [o.purityId, o.weightGb]));
  const runningGm = new Map(opening.map((o) => [o.purityId, o.weightGm]));

  return rowsAsc.map((row) => {
    const gb = (runningGb.get(row.purityId) ?? 0) + row.weightGbDelta;
    const gm = (runningGm.get(row.purityId) ?? 0) + row.weightGmDelta;
    runningGb.set(row.purityId, gb);
    runningGm.set(row.purityId, gm);
    return { ...row, cumulativeWeightGb: gb, cumulativeWeightGm: gm };
  });
}
