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

export function splitByPurity<T extends VolumeRow>(
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
