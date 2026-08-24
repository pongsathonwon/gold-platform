import { describe, it, expect } from "vitest";
import {
  buildBalanceSheet, buildBalanceWorkbook, buildMovementSheet, buildMovementWorkbook,
  sectionOpening, balanceFileName, movementFileName,
  type ExportLabels, type ExportMovementRow,
} from "./inventoryExport";
import type { VolumeRow, MovementOpening } from "./inventoryVolume";

const labels: ExportLabels = {
  pool: (row, unit) => (unit === "kg" ? `origin:${row.origin}` : `brand:${row.brandId}`),
  productType: (id) => `type:${id}`,
  referenceType: (type) => `ref:${type}`,
};

// fixed so the generated-at line is deterministic
const GENERATED_AT = new Date(2026, 7, 24, 9, 30);
const meta = { labels, generatedAt: GENERATED_AT, generatedBy: "ผู้ใช้ทดสอบ" };

function volumeRow(overrides: Partial<VolumeRow> = {}): VolumeRow {
  return {
    purityId: "965",
    brandId: "brand-1",
    origin: "foreign",
    productTypeId: "BAR",
    totalWeightGb: 10,
    totalWeightGm: 152.44,
    totalCost: 62750,
    ...overrides,
  };
}

function movementRow(overrides: Partial<ExportMovementRow> = {}): ExportMovementRow {
  return {
    purityId: "965",
    brandId: "brand-1",
    origin: "foreign",
    productTypeId: "BAR",
    referenceType: "WHOLESALE_BUY",
    weightGbDelta: 5,
    weightGmDelta: 76.22,
    costDelta: 31375,
    movementDate: "2026-08-24",
    movedBy: "op1",
    notes: null,
    cumulativeWeightGb: 15,
    cumulativeWeightGm: 228.66,
    ...overrides,
  };
}

/** Cell value at a position, unwrapping the object form the builders emit. */
const cell = (sheet: ReturnType<typeof buildBalanceSheet>, row: number, col: number) => {
  const value = sheet[row]?.[col];
  return value && typeof value === "object" ? (value as { value?: unknown }).value : value;
};
const cellFormat = (sheet: ReturnType<typeof buildBalanceSheet>, row: number, col: number) => {
  const value = sheet[row]?.[col];
  return value && typeof value === "object" ? (value as { format?: string }).format : undefined;
};

// title, window, generated-by, blank, header
const HEADER_ROW = 4;
const FIRST_BODY_ROW = 5;

describe("buildBalanceSheet", () => {
  it("writes weights and money as numbers, never as formatted strings", () => {
    const sheet = buildBalanceSheet({
      rows: [volumeRow({ totalWeightGb: 1234.5, totalCost: 7_654_321 })],
      unit: "gb",
      asOf: "2026-08-24",
      ...meta,
    });

    // a formatted string here is the whole bug this guards against — Excel cannot sum text
    expect(cell(sheet, FIRST_BODY_ROW, 2)).toBe(1234.5);
    expect(cell(sheet, FIRST_BODY_ROW, 3)).toBe(7_654_321);
    expect(cellFormat(sheet, FIRST_BODY_ROW, 2)).toBe("#,##0.####");
    expect(cellFormat(sheet, FIRST_BODY_ROW, 3)).toBe("#,##0.00");
  });

  it("labels the first column by brand on the 96.5 sheet and by origin on the 99.9 one", () => {
    const row = volumeRow({ brandId: "NA", origin: "domestic" });
    expect(cell(buildBalanceSheet({ rows: [row], unit: "gb", asOf: "2026-08-24", ...meta }), FIRST_BODY_ROW, 0))
      .toBe("brand:NA");
    expect(cell(buildBalanceSheet({ rows: [row], unit: "kg", asOf: "2026-08-24", ...meta }), FIRST_BODY_ROW, 0))
      .toBe("origin:domestic");
  });

  it("states the weight column's unit in its header", () => {
    expect(cell(buildBalanceSheet({ rows: [], unit: "gb", asOf: "2026-08-24", ...meta }), HEADER_ROW, 2))
      .toBe("น้ำหนัก (บาท)");
    expect(cell(buildBalanceSheet({ rows: [], unit: "kg", asOf: "2026-08-24", ...meta }), HEADER_ROW, 2))
      .toBe("น้ำหนัก (กก.)");
  });

  it("converts grams to kilograms on the 99.9 sheet", () => {
    const sheet = buildBalanceSheet({
      rows: [volumeRow({ totalWeightGm: 2000 })],
      unit: "kg",
      asOf: "2026-08-24",
      ...meta,
    });
    expect(cell(sheet, FIRST_BODY_ROW, 2)).toBe(2);
  });

  it("averages per gold baht on the kilogram sheet too, matching the column header", () => {
    const sheet = buildBalanceSheet({
      rows: [volumeRow({ totalWeightGb: 10, totalWeightGm: 2000, totalCost: 62750 })],
      unit: "kg",
      asOf: "2026-08-24",
      ...meta,
    });
    // 62750 / 10 GB — not 62750 / 2 kg, which would be a THB/kg figure under a THB/บาททอง heading
    expect(cell(sheet, FIRST_BODY_ROW, 4)).toBe(6275);
  });

  it("totals the rows in a footer", () => {
    const sheet = buildBalanceSheet({
      rows: [
        volumeRow({ totalWeightGb: 10, totalCost: 60000 }),
        volumeRow({ brandId: "brand-2", totalWeightGb: 5, totalCost: 30000 }),
      ],
      unit: "gb",
      asOf: "2026-08-24",
      ...meta,
    });
    const footer = sheet.length - 1;
    expect(cell(sheet, footer, 0)).toBe("รวม");
    expect(cell(sheet, footer, 2)).toBe(15);
    expect(cell(sheet, footer, 3)).toBe(90000);
    expect(cell(sheet, footer, 4)).toBe(6000);
  });

  it("says so rather than totalling when the section is empty", () => {
    const sheet = buildBalanceSheet({ rows: [], unit: "gb", asOf: "2026-08-24", ...meta });
    expect(cell(sheet, FIRST_BODY_ROW, 0)).toBe("ไม่พบรายการ");
    expect(sheet).toHaveLength(FIRST_BODY_ROW + 1);
  });

  it("carries the as-of date and the operator in the title block", () => {
    const sheet = buildBalanceSheet({ rows: [], unit: "gb", asOf: "2026-08-24", ...meta });
    expect(String(cell(sheet, 1, 0))).toContain("2569");
    expect(String(cell(sheet, 2, 0))).toContain("ผู้ใช้ทดสอบ");
  });
});

describe("buildBalanceWorkbook", () => {
  it("always emits both purity sheets, empty or not", () => {
    const sheets = buildBalanceWorkbook({
      nineSixFive: [volumeRow()],
      nineNineNine: [],
      asOf: "2026-08-24",
      ...meta,
    });
    expect(sheets.map((s) => s.sheet)).toEqual(["ทอง 96.5%", "ทอง 99.9%"]);
  });
});

describe("sectionOpening", () => {
  const opening: MovementOpening[] = [
    { purityId: "965", weightGb: 12, weightGm: 182.9 },
    { purityId: "999", weightGb: 65.6, weightGm: 1000 },
  ];

  it("sums the section's purities in gold baht", () => {
    expect(sectionOpening(opening, (id) => id === "965", "gb")).toBe(12);
  });

  it("converts to kilograms for the 99.9 section", () => {
    expect(sectionOpening(opening, (id) => id === "999", "kg")).toBe(1);
  });

  it("is zero when no purity belongs to the section", () => {
    expect(sectionOpening(opening, () => false, "gb")).toBe(0);
  });
});

// title block, header, opening
const MOVEMENT_OPENING_ROW = 5;
const MOVEMENT_FIRST_BODY_ROW = 6;

describe("buildMovementSheet", () => {
  const base = { unit: "gb" as const, from: "2026-08-01", to: "2026-08-24", opening: 12, ...meta };

  it("opens with the carried-in balance so the cumulative column is reproducible", () => {
    const sheet = buildMovementSheet({ rows: [movementRow()], ...base });
    expect(cell(sheet, MOVEMENT_OPENING_ROW, 0)).toBe("ยอดยกมา");
    expect(cell(sheet, MOVEMENT_OPENING_ROW, 6)).toBe(12);
  });

  it("keeps the opening row even when nothing moved in the window", () => {
    const sheet = buildMovementSheet({ rows: [], ...base });
    expect(cell(sheet, MOVEMENT_OPENING_ROW, 6)).toBe(12);
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 0)).toBe("ไม่พบรายการ");
  });

  it("writes deltas as signed numbers with a signed format", () => {
    const sheet = buildMovementSheet({
      rows: [movementRow({ weightGbDelta: -5, costDelta: -31375 })],
      ...base,
    });
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 4)).toBe(-5);
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 5)).toBe(-31375);
    expect(cellFormat(sheet, MOVEMENT_FIRST_BODY_ROW, 4)).toBe("+#,##0.####;-#,##0.####");
    expect(cellFormat(sheet, MOVEMENT_FIRST_BODY_ROW, 5)).toBe("+#,##0.00;-#,##0.00");
  });

  it("renders the date as Thai Buddhist-era text", () => {
    const sheet = buildMovementSheet({ rows: [movementRow({ movementDate: "2026-08-24" })], ...base });
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 0)).toBe("24/8/2569");
  });

  it("uses the transaction-type label rather than the raw reference type", () => {
    const sheet = buildMovementSheet({ rows: [movementRow()], ...base });
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 3)).toBe("ref:WHOLESALE_BUY");
  });

  it("closes on the last row's cumulative, not on the summed deltas", () => {
    const sheet = buildMovementSheet({
      rows: [
        movementRow({ weightGbDelta: 5, costDelta: 100, cumulativeWeightGb: 17 }),
        movementRow({ weightGbDelta: -3, costDelta: -60, cumulativeWeightGb: 14 }),
      ],
      ...base,
    });
    const footer = sheet.length - 1;
    expect(cell(sheet, footer, 4)).toBe(2); // net movement over the window
    expect(cell(sheet, footer, 5)).toBe(40);
    expect(cell(sheet, footer, 6)).toBe(14); // balance after the last row, opening included
  });

  it("converts deltas and balances to kilograms on the 99.9 sheet", () => {
    const sheet = buildMovementSheet({
      rows: [movementRow({ weightGmDelta: 500, cumulativeWeightGm: 1500 })],
      ...base,
      unit: "kg",
    });
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 4)).toBe(0.5);
    expect(cell(sheet, MOVEMENT_FIRST_BODY_ROW, 6)).toBe(1.5);
  });

  it("carries the window in the title block", () => {
    const sheet = buildMovementSheet({ rows: [], ...base });
    expect(String(cell(sheet, 1, 0))).toContain("1/8/2569");
    expect(String(cell(sheet, 1, 0))).toContain("24/8/2569");
  });
});

describe("buildMovementWorkbook", () => {
  it("gives each sheet its own opening balance in its own unit", () => {
    const sheets = buildMovementWorkbook({
      nineSixFive: [],
      nineNineNine: [],
      openingGb: 12,
      openingKg: 1.5,
      from: "2026-08-01",
      to: "2026-08-24",
      ...meta,
    });
    expect(cell(sheets[0].data, MOVEMENT_OPENING_ROW, 6)).toBe(12);
    expect(cell(sheets[1].data, MOVEMENT_OPENING_ROW, 6)).toBe(1.5);
  });

  it("freezes the header and the opening row together", () => {
    const sheets = buildMovementWorkbook({
      nineSixFive: [],
      nineNineNine: [],
      openingGb: 0,
      openingKg: 0,
      from: "2026-08-01",
      to: "2026-08-24",
      ...meta,
    });
    expect(sheets[0].stickyRowsCount).toBe(MOVEMENT_FIRST_BODY_ROW);
  });
});

describe("file names", () => {
  it("names the balance file for the day it was taken", () => {
    expect(balanceFileName("2026-08-24")).toBe("คลังทองคำแท่ง_2026-08-24.xlsx");
  });

  it("names the movement file for its window", () => {
    expect(movementFileName("2026-08-01", "2026-08-24")).toBe(
      "ความเคลื่อนไหวทองแท่ง_2026-08-01_ถึง_2026-08-24.xlsx",
    );
  });
});
