import { describe, it, expect } from "vitest";
import { derivePricePerGb999 } from "@gold-platform/types";
import {
  buildTransactionSheet, buildTransactionWorkbook, summarise, windowLabel, transactionFileName,
  BUY_REPORT, SELL_REPORT, RETAIL_BUY_REPORT, RETAIL_SELL_REPORT, type TransactionExportRow,
} from "./transactionExport";

const GENERATED_AT = new Date(2026, 7, 24, 9, 30);
const base = {
  config: BUY_REPORT,
  from: "2026-08-18",
  to: "2026-08-24",
  generatedAt: GENERATED_AT,
  generatedBy: "ผู้ใช้ทดสอบ",
};

function row(overrides: Partial<TransactionExportRow> = {}): TransactionExportRow {
  return {
    transactionDate: "2026-08-24",
    counterparty: "ฮั่วเซ่งเฮง",
    productType: "ทองแท่ง",
    weightGb: 10,
    weightGm: 152.44,
    comparisonWeightGb: 10,
    comparisonWeightGm: 152.44,
    pricePerGb: 62750,
    amount: 627500,
    status: "เข้าสต๊อกแล้ว",
    countsTowardTotal: true,
    ...overrides,
  };
}

const cell = (sheet: ReturnType<typeof buildTransactionSheet>, r: number, c: number) => {
  const value = sheet[r]?.[c];
  return value && typeof value === "object" ? (value as { value?: unknown }).value : value;
};

// title block (4) + summary block (6) = 10, so the header is row index 10
const HEADER_ROW = 10;
const FIRST_BODY_ROW = 11;
// within the summary block
const SUMMARY_COUNT_ROW = 5;
const SUMMARY_WEIGHT_ROW = 6;
const SUMMARY_AMOUNT_ROW = 7;
const SUMMARY_AVERAGE_ROW = 8;

describe("summarise", () => {
  it("weights the average by weight rather than averaging the row prices", () => {
    // 1 baht at 60,000 and 9 baht at 70,000 — a plain mean of the two prices would say 65,000,
    // which is the answer to a question nobody asked. The gold actually cost 69,000/baht.
    const summary = summarise(
      [
        row({ weightGb: 1, amount: 60_000, pricePerGb: 60_000 }),
        row({ weightGb: 9, amount: 630_000, pricePerGb: 70_000 }),
      ],
      "gb",
    );
    expect(summary.averagePricePerGb).toBe(69_000);
  });

  it("leaves excluded rows out of every figure but still counts them", () => {
    const summary = summarise(
      [
        row({ weightGb: 10, amount: 627_500 }),
        row({ weightGb: 5, amount: 300_000, countsTowardTotal: false }),
      ],
      "gb",
    );
    expect(summary.counted).toBe(1);
    expect(summary.excluded).toBe(1);
    expect(summary.totalWeight).toBe(10);
    expect(summary.totalAmount).toBe(627_500);
    expect(summary.averagePricePerGb).toBe(62_750);
  });

  it("averages per gold baht on the kilogram section too", () => {
    // 2 kg of 99.9%, 131.2 gold baht, 6,560,000 THB — the average is per บาททอง, matching the
    // label and the ราคา/บาททอง column, not per kilogram
    const summary = summarise(
      [row({ weightGb: 131.2, weightGm: 2000, amount: 6_560_000 })],
      "kg",
    );
    expect(summary.totalWeight).toBe(2);
    // a quotient, so exact binary equality is testing the float and not the logic — 131.2 is not
    // representable, and the cell's #,##0.00 format renders the residue away
    expect(summary.averagePricePerGb).toBeCloseTo(50_000, 6);
  });

  it("has no average — not zero, not NaN — when every row is excluded", () => {
    // 0.00 in a price column would claim the gold cost nothing; there simply is no average
    const summary = summarise([row({ countsTowardTotal: false })], "gb");
    expect(summary.averagePricePerGb).toBeNull();
    expect(summary.totalWeight).toBe(0);
  });

  it("has no average on an empty section", () => {
    expect(summarise([], "gb").averagePricePerGb).toBeNull();
  });

  it("never divides by zero even when amounts are present", () => {
    // a zero-weight row is not expected, but 0/0 printing NaN into a manager's report is the
    // failure this guards, and it must hold whatever the numerator is
    expect(summarise([row({ weightGb: 0, weightGm: 0, amount: 5000 })], "gb").averagePricePerGb)
      .toBeNull();
  });
});

/**
 * The business prices gold per gold baht, and one gold baht of 99.9% is worth more than one gold
 * baht of 96.5%. Because kg→GB is a pure mass conversion, that difference has to arrive through
 * the price — so these pin the relationship the report is read for.
 */
describe("average across purities", () => {
  const PRICE_965 = 62_750;
  const PRICE_999 = derivePricePerGb999(PRICE_965);
  const CONVERSION_FACTOR = 15.244;

  // a 99.9% deal is placed in kilograms; the server resolves mass gold baht and prices per GB
  const kilograms = (kg: number) => {
    const weightGm = kg * 1000;
    const weightGb = weightGm / CONVERSION_FACTOR;
    return row({
      weightGb,
      weightGm,
      comparisonWeightGb: weightGb,
      comparisonWeightGm: weightGm,
      pricePerGb: PRICE_999,
      amount: PRICE_999 * weightGb,
    });
  };

  const goldBaht = (gb: number) =>
    row({
      weightGb: gb,
      weightGm: gb * CONVERSION_FACTOR,
      comparisonWeightGb: gb,
      comparisonWeightGm: gb * CONVERSION_FACTOR,
      pricePerGb: PRICE_965,
      amount: PRICE_965 * gb,
    });

  it("hands back the sheet's own quote — value over mass gold baht", () => {
    expect(summarise([goldBaht(10)], "gb").averagePricePerGb).toBeCloseTo(PRICE_965, 6);
    expect(summarise([kilograms(2)], "kg").averagePricePerGb).toBeCloseTo(PRICE_999, 6);
  });

  it("reads higher on the 99.9 sheet than on the 96.5 sheet", () => {
    const sheets = buildTransactionWorkbook({
      nineSixFive: [goldBaht(10), goldBaht(5)],
      nineNineNine: [kilograms(2), kilograms(1)],
      ...base,
    });
    const average965 = cell(sheets[0].data, SUMMARY_AVERAGE_ROW, 1) as number;
    const average999 = cell(sheets[1].data, SUMMARY_AVERAGE_ROW, 1) as number;

    expect(average999).toBeGreaterThan(average965);
    // and by exactly the purity ratio, since that is the only thing separating the two quotes
    expect(average999 / average965).toBeCloseTo(99.9 / 96.5, 4);
  });

  it("does not let the kilogram sheet divide by kilograms", () => {
    // 2 kg is 131.16 mass gold baht — dividing by 2 would give a THB/kg figure some 65× larger,
    // printed under a THB/บาททอง heading
    const average = summarise([kilograms(2)], "kg").averagePricePerGb as number;
    const perKilogram = PRICE_999 * (2000 / CONVERSION_FACTOR) / 2;
    expect(average).toBeCloseTo(PRICE_999, 6);
    expect(average).toBeLessThan(perKilogram);
  });
});

describe("buildTransactionSheet", () => {
  it("puts the summary above the table, as numbers", () => {
    const sheet = buildTransactionSheet({
      rows: [row({ weightGb: 10, amount: 627_500 })],
      unit: "gb",
      ...base,
    });
    expect(cell(sheet, SUMMARY_COUNT_ROW, 1)).toBe(1);
    expect(cell(sheet, SUMMARY_WEIGHT_ROW, 1)).toBe(10);
    expect(cell(sheet, SUMMARY_AMOUNT_ROW, 1)).toBe(627_500);
    expect(cell(sheet, SUMMARY_AVERAGE_ROW, 1)).toBe(62_750);
    expect(cell(sheet, SUMMARY_AVERAGE_ROW, 0)).toBe("ราคาซื้อเฉลี่ย (บาท/บาททอง)");
  });

  it("notes the excluded rows beside the count", () => {
    const sheet = buildTransactionSheet({
      rows: [row(), row({ countsTowardTotal: false })],
      unit: "gb",
      ...base,
    });
    expect(String(cell(sheet, SUMMARY_COUNT_ROW, 2))).toContain("1 รายการ");
  });

  it("says nothing about exclusions when there are none", () => {
    const sheet = buildTransactionSheet({ rows: [row()], unit: "gb", ...base });
    expect(cell(sheet, SUMMARY_COUNT_ROW, 2)).toBe("");
  });

  it("keeps excluded rows in the body so the summary is auditable", () => {
    const sheet = buildTransactionSheet({
      rows: [row({ counterparty: "ก" }), row({ counterparty: "ข", countsTowardTotal: false })],
      unit: "gb",
      ...base,
    });
    expect(cell(sheet, FIRST_BODY_ROW + 1, 8)).toBe("ไม่");
  });

  it("names the weight columns for the domain and the section's unit", () => {
    const buy = buildTransactionSheet({ rows: [], unit: "gb", ...base });
    expect(cell(buy, HEADER_ROW, 3)).toBe("น้ำหนักที่รับ (บาท)");
    expect(cell(buy, HEADER_ROW, 4)).toBe("น้ำหนักที่สั่ง (บาท)");

    const sell = buildTransactionSheet({ rows: [], unit: "kg", ...base, config: SELL_REPORT });
    expect(cell(sell, HEADER_ROW, 3)).toBe("น้ำหนักที่ตกลง (กก.)");
    expect(cell(sell, HEADER_ROW, 4)).toBe("น้ำหนักที่ผู้ซื้อชั่งได้ (กก.)");
    expect(cell(sell, HEADER_ROW, 1)).toBe("ผู้รับซื้อส่ง");
  });

  it("leaves the comparison cell empty when there is nothing to compare", () => {
    const sheet = buildTransactionSheet({
      rows: [row({ comparisonWeightGb: null, comparisonWeightGm: null })],
      unit: "gb",
      ...base,
      config: SELL_REPORT,
    });
    expect(cell(sheet, FIRST_BODY_ROW, 4)).toBeNull();
  });

  it("converts both weights to kilograms on the 99.9 sheet", () => {
    const sheet = buildTransactionSheet({
      rows: [row({ weightGm: 2000, comparisonWeightGm: 3000 })],
      unit: "kg",
      ...base,
    });
    expect(cell(sheet, FIRST_BODY_ROW, 3)).toBe(2);
    expect(cell(sheet, FIRST_BODY_ROW, 4)).toBe(3);
  });

  it("renders the date as Thai Buddhist-era text", () => {
    const sheet = buildTransactionSheet({ rows: [row()], unit: "gb", ...base });
    expect(cell(sheet, FIRST_BODY_ROW, 0)).toBe("24/8/2569");
  });

  it("says so rather than totalling when the section is empty", () => {
    const sheet = buildTransactionSheet({ rows: [], unit: "gb", ...base });
    expect(cell(sheet, FIRST_BODY_ROW, 0)).toBe("ไม่พบรายการ");
    expect(sheet).toHaveLength(FIRST_BODY_ROW + 1);
  });

  it("totals in a footer that agrees with the summary", () => {
    const sheet = buildTransactionSheet({
      rows: [row({ weightGb: 10, amount: 600_000 }), row({ weightGb: 5, amount: 300_000 })],
      unit: "gb",
      ...base,
    });
    const footer = sheet.length - 1;
    expect(cell(sheet, footer, 3)).toBe(15);
    expect(cell(sheet, footer, 6)).toBe(900_000);
    expect(cell(sheet, footer, 3)).toBe(cell(sheet, SUMMARY_WEIGHT_ROW, 1));
    expect(cell(sheet, footer, 6)).toBe(cell(sheet, SUMMARY_AMOUNT_ROW, 1));
  });
});

describe("buildTransactionWorkbook", () => {
  it("emits both purity sheets, each summarising only its own", () => {
    const sheets = buildTransactionWorkbook({
      nineSixFive: [row({ weightGb: 10, amount: 600_000 })],
      nineNineNine: [row({ weightGb: 131.2, weightGm: 2000, amount: 6_560_000 })],
      ...base,
    });
    expect(sheets.map((s) => s.sheet)).toEqual(["ทอง 96.5%", "ทอง 99.9%"]);
    expect(cell(sheets[0].data, SUMMARY_AVERAGE_ROW, 1)).toBe(60_000);
    expect(cell(sheets[1].data, SUMMARY_AVERAGE_ROW, 1)).toBeCloseTo(50_000, 6);
  });

  it("freezes the title, the summary and the header together", () => {
    const sheets = buildTransactionWorkbook({ nineSixFive: [], nineNineNine: [], ...base });
    expect(sheets[0].stickyRowsCount).toBe(FIRST_BODY_ROW);
  });
});

describe("windowLabel", () => {
  it("describes a closed window", () => {
    expect(windowLabel("2026-08-18", "2026-08-24")).toBe("ตั้งแต่ 18/8/2569 ถึง 24/8/2569");
  });

  it("describes an open end, since either filter can be cleared", () => {
    expect(windowLabel("2026-08-18", "")).toBe("ตั้งแต่ 18/8/2569 เป็นต้นไป");
    expect(windowLabel("", "2026-08-24")).toBe("ถึง 24/8/2569");
    expect(windowLabel("", "")).toBe("ทุกช่วงเวลา");
  });
});

describe("transactionFileName", () => {
  it("names the file after the window it covers", () => {
    expect(transactionFileName(BUY_REPORT, "2026-08-18", "2026-08-24")).toBe(
      "รายงานซื้อส่ง_2026-08-18_ถึง_2026-08-24.xlsx",
    );
    expect(transactionFileName(SELL_REPORT, "", "")).toBe("รายงานขายส่ง_ทั้งหมด.xlsx");
  });
});

/**
 * The retail reports.
 *
 * These are the same builder with a different config, so the tests here cover only what retail does
 * differently: it has no comparison weight, its price column is one figure at both purities, and its
 * fee never reaches the file. The arithmetic itself is already covered above.
 */
describe("the retail reports", () => {
  const retail = (overrides: Partial<TransactionExportRow> = {}): TransactionExportRow =>
    row({
      counterparty: "G000-สำนักงานใหญ่",
      status: "ยืนยันแล้ว",
      // retail records one weight and has nothing to compare it against
      comparisonWeightGb: null,
      comparisonWeightGm: null,
      ...overrides,
    });

  it("leaves the comparison column empty rather than repeating the weight", () => {
    const sheet = buildTransactionSheet({
      rows: [retail()], unit: "gb", ...base, config: RETAIL_BUY_REPORT,
    });
    expect(cell(sheet, FIRST_BODY_ROW, 3)).toBe(10);
    // an empty cell, not the same figure twice — a repeated number reads as a real comparison
    expect(cell(sheet, FIRST_BODY_ROW, 4)).toBeNull();
  });

  it("names the branch as the counterparty", () => {
    const sheet = buildTransactionSheet({
      rows: [retail()], unit: "gb", ...base, config: RETAIL_SELL_REPORT,
    });
    // a walk-in customer is not an entity in this system; the branch is the only party it can name
    expect(cell(sheet, HEADER_ROW, 1)).toBe("สาขา");
    expect(cell(sheet, FIRST_BODY_ROW, 1)).toBe("G000-สำนักงานใหญ่");
  });

  it("totals the same figures the footer does", () => {
    const rows = [
      retail({ weightGb: 5, amount: 245_000, pricePerGb: 49_000 }),
      retail({ weightGb: 3, amount: 150_000, pricePerGb: 50_000 }),
    ];
    const sheet = buildTransactionSheet({
      rows, unit: "gb", ...base, config: RETAIL_BUY_REPORT,
    });
    const footer = sheet[sheet.length - 1];
    const footerValue = (c: number) => (footer?.[c] as { value?: unknown } | null)?.value;

    expect(cell(sheet, SUMMARY_WEIGHT_ROW, 1)).toBe(8);
    expect(cell(sheet, SUMMARY_AMOUNT_ROW, 1)).toBe(395_000);
    // the summary above the table and the footer below it must agree, or the file argues with itself
    expect(footerValue(3)).toBe(8);
    expect(footerValue(6)).toBe(395_000);
  });

  it("keeps a cancelled trade in the body but out of the totals", () => {
    const rows = [
      retail({ weightGb: 5, amount: 245_000 }),
      retail({ weightGb: 4, amount: 200_000, status: "ยกเลิก", countsTowardTotal: false }),
    ];
    const sheet = buildTransactionSheet({
      rows, unit: "gb", ...base, config: RETAIL_BUY_REPORT,
    });

    // both rows are present — a total that says "excluding 1" with no way to see which is not auditable
    expect(cell(sheet, FIRST_BODY_ROW, 8)).toBe("ใช่");
    expect(cell(sheet, FIRST_BODY_ROW + 1, 8)).toBe("ไม่");
    expect(cell(sheet, SUMMARY_COUNT_ROW, 1)).toBe(1);
    expect(cell(sheet, SUMMARY_WEIGHT_ROW, 1)).toBe(5);
    expect(cell(sheet, SUMMARY_AVERAGE_ROW, 1)).toBe(49_000);
  });

  it("has no average when every trade in the window was cancelled", () => {
    const sheet = buildTransactionSheet({
      rows: [retail({ countsTowardTotal: false })], unit: "gb", ...base, config: RETAIL_SELL_REPORT,
    });
    // an em dash, not 0.00 — a zero in a price column claims the gold was free
    expect(cell(sheet, SUMMARY_AVERAGE_ROW, 1)).toBe("—");
  });

  it("divides the kilogram sheet by gold baht, matching its heading", () => {
    // 1 kg at 65,000/บาททอง: the sheet shows kilograms but the average is priced per gold baht,
    // exactly as the 96.5% sheet is, or the two could not be read against each other.
    const sheet = buildTransactionSheet({
      rows: [retail({ weightGb: 10, weightGm: 1000, amount: 650_000, pricePerGb: 65_000 })],
      unit: "kg", ...base, config: RETAIL_BUY_REPORT,
    });
    expect(cell(sheet, SUMMARY_WEIGHT_ROW, 1)).toBe(1);
    expect(cell(sheet, SUMMARY_AVERAGE_ROW, 1)).toBe(65_000);
  });

  it("always writes both purity sheets", () => {
    const workbook = buildTransactionWorkbook({
      nineSixFive: [retail()], nineNineNine: [], ...base, config: RETAIL_SELL_REPORT,
    });
    // a workbook missing ทอง 99.9% reads as a broken export rather than a purity nobody traded
    expect(workbook.map((s) => s.sheet)).toEqual(["ทอง 96.5%", "ทอง 99.9%"]);
  });

  it("names the retail files distinctly from the wholesale ones", () => {
    expect(transactionFileName(RETAIL_BUY_REPORT, "2026-08-18", "2026-08-24"))
      .toBe("รายงานซื้อปลีก_2026-08-18_ถึง_2026-08-24.xlsx");
    expect(transactionFileName(RETAIL_SELL_REPORT, "", ""))
      .toBe("รายงานขายปลีก_ทั้งหมด.xlsx");
  });
});
