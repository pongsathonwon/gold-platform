import { describe, it, expect } from "vitest";
import {
  buildWholesaleSheet, buildWholesaleWorkbook, summarise, windowLabel, wholesaleFileName,
  BUY_REPORT, SELL_REPORT, type WholesaleExportRow,
} from "./wholesaleExport";

const GENERATED_AT = new Date(2026, 7, 24, 9, 30);
const base = {
  config: BUY_REPORT,
  from: "2026-08-18",
  to: "2026-08-24",
  generatedAt: GENERATED_AT,
  generatedBy: "ผู้ใช้ทดสอบ",
};

function row(overrides: Partial<WholesaleExportRow> = {}): WholesaleExportRow {
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

const cell = (sheet: ReturnType<typeof buildWholesaleSheet>, r: number, c: number) => {
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

  it("is zero rather than NaN when every row is excluded", () => {
    const summary = summarise([row({ countsTowardTotal: false })], "gb");
    expect(summary.averagePricePerGb).toBe(0);
    expect(summary.totalWeight).toBe(0);
  });

  it("is zero on an empty section", () => {
    expect(summarise([], "gb").averagePricePerGb).toBe(0);
  });
});

describe("buildWholesaleSheet", () => {
  it("puts the summary above the table, as numbers", () => {
    const sheet = buildWholesaleSheet({
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
    const sheet = buildWholesaleSheet({
      rows: [row(), row({ countsTowardTotal: false })],
      unit: "gb",
      ...base,
    });
    expect(String(cell(sheet, SUMMARY_COUNT_ROW, 2))).toContain("1 รายการ");
  });

  it("says nothing about exclusions when there are none", () => {
    const sheet = buildWholesaleSheet({ rows: [row()], unit: "gb", ...base });
    expect(cell(sheet, SUMMARY_COUNT_ROW, 2)).toBe("");
  });

  it("keeps excluded rows in the body so the summary is auditable", () => {
    const sheet = buildWholesaleSheet({
      rows: [row({ counterparty: "ก" }), row({ counterparty: "ข", countsTowardTotal: false })],
      unit: "gb",
      ...base,
    });
    expect(cell(sheet, FIRST_BODY_ROW + 1, 8)).toBe("ไม่");
  });

  it("names the weight columns for the domain and the section's unit", () => {
    const buy = buildWholesaleSheet({ rows: [], unit: "gb", ...base });
    expect(cell(buy, HEADER_ROW, 3)).toBe("น้ำหนักที่รับ (บาท)");
    expect(cell(buy, HEADER_ROW, 4)).toBe("น้ำหนักที่สั่ง (บาท)");

    const sell = buildWholesaleSheet({ rows: [], unit: "kg", ...base, config: SELL_REPORT });
    expect(cell(sell, HEADER_ROW, 3)).toBe("น้ำหนักที่ตกลง (กก.)");
    expect(cell(sell, HEADER_ROW, 4)).toBe("น้ำหนักที่ผู้ซื้อชั่งได้ (กก.)");
    expect(cell(sell, HEADER_ROW, 1)).toBe("ผู้รับซื้อส่ง");
  });

  it("leaves the comparison cell empty when there is nothing to compare", () => {
    const sheet = buildWholesaleSheet({
      rows: [row({ comparisonWeightGb: null, comparisonWeightGm: null })],
      unit: "gb",
      ...base,
      config: SELL_REPORT,
    });
    expect(cell(sheet, FIRST_BODY_ROW, 4)).toBeNull();
  });

  it("converts both weights to kilograms on the 99.9 sheet", () => {
    const sheet = buildWholesaleSheet({
      rows: [row({ weightGm: 2000, comparisonWeightGm: 3000 })],
      unit: "kg",
      ...base,
    });
    expect(cell(sheet, FIRST_BODY_ROW, 3)).toBe(2);
    expect(cell(sheet, FIRST_BODY_ROW, 4)).toBe(3);
  });

  it("renders the date as Thai Buddhist-era text", () => {
    const sheet = buildWholesaleSheet({ rows: [row()], unit: "gb", ...base });
    expect(cell(sheet, FIRST_BODY_ROW, 0)).toBe("24/8/2569");
  });

  it("says so rather than totalling when the section is empty", () => {
    const sheet = buildWholesaleSheet({ rows: [], unit: "gb", ...base });
    expect(cell(sheet, FIRST_BODY_ROW, 0)).toBe("ไม่พบรายการ");
    expect(sheet).toHaveLength(FIRST_BODY_ROW + 1);
  });

  it("totals in a footer that agrees with the summary", () => {
    const sheet = buildWholesaleSheet({
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

describe("buildWholesaleWorkbook", () => {
  it("emits both purity sheets, each summarising only its own", () => {
    const sheets = buildWholesaleWorkbook({
      nineSixFive: [row({ weightGb: 10, amount: 600_000 })],
      nineNineNine: [row({ weightGb: 131.2, weightGm: 2000, amount: 6_560_000 })],
      ...base,
    });
    expect(sheets.map((s) => s.sheet)).toEqual(["ทอง 96.5%", "ทอง 99.9%"]);
    expect(cell(sheets[0].data, SUMMARY_AVERAGE_ROW, 1)).toBe(60_000);
    expect(cell(sheets[1].data, SUMMARY_AVERAGE_ROW, 1)).toBeCloseTo(50_000, 6);
  });

  it("freezes the title, the summary and the header together", () => {
    const sheets = buildWholesaleWorkbook({ nineSixFive: [], nineNineNine: [], ...base });
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

describe("wholesaleFileName", () => {
  it("names the file after the window it covers", () => {
    expect(wholesaleFileName(BUY_REPORT, "2026-08-18", "2026-08-24")).toBe(
      "รายงานซื้อส่ง_2026-08-18_ถึง_2026-08-24.xlsx",
    );
    expect(wholesaleFileName(SELL_REPORT, "", "")).toBe("รายงานขายส่ง_ทั้งหมด.xlsx");
  });
});
