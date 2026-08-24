import type { SheetData, Row } from "write-excel-file/browser";
import { formatBusinessDate } from "./format";
import {
  bold, count, emptyRow, headerCell, money, strong, text, titleBlock, unitSuffix, weight,
  SHEET_NAME, TITLE_BLOCK_ROWS,
  type ExportSheet, type ExportUnit,
} from "./excel";

/**
 * The wholesale buy and sell reports.
 *
 * One builder serves both. The two domains differ in vocabulary and in which weight is the real
 * one — buy reports what was *delivered* against what was ordered, sell reports what was *agreed*
 * against what the buyer contests — but the shape of the report is identical, so the differences
 * are a config object rather than two near-copies that drift.
 *
 * Each page maps its own transactions into `WholesaleExportRow` before calling in. That mapping is
 * where `countsTowardTotal()` and the page's own `amountOf` are applied, so the file totals exactly
 * what the screen totals.
 */

/**
 * A transaction flattened to what the report shows. The page has already resolved supplier and
 * product-type names and decided which weight and amount count.
 */
export interface WholesaleExportRow {
  transactionDate: string;
  counterparty: string;
  productType: string;
  /** The weight that counts: delivered on a buy, agreed on a sell. */
  weightGb: number;
  weightGm: number;
  /**
   * The weight beside it — ordered on a buy, the buyer's contested figure on a sell. Null when
   * there is nothing to compare against, which on the sell side is the ordinary case.
   *
   * Its own column rather than the screen's parenthetical, because "12 (สั่ง 15)" in a numeric
   * cell would make the cell text and cost the column its arithmetic.
   */
  comparisonWeightGb: number | null;
  comparisonWeightGm: number | null;
  pricePerGb: number;
  amount: number;
  status: string;
  /**
   * Whether this row feeds the totals and the average. Carried per row rather than filtered out,
   * so an excluded transaction still appears in the report — a summary that says "excluding 2"
   * with no way to see which two is not auditable.
   */
  countsTowardTotal: boolean;
}

/** What differs between the buy report and the sell report. */
export interface WholesaleReportConfig {
  /** Report title and file-name stem, e.g. "รายงานซื้อส่ง". */
  reportTitle: string;
  fileStem: string;
  counterpartyHeader: string;
  /** Weight column labels; the builder appends the section's unit. */
  weightLabel: string;
  comparisonWeightLabel: string;
  /** e.g. "ราคาซื้อเฉลี่ย (บาท/บาททอง)" — the figure the manager opens the file for. */
  averageLabel: string;
  /** Names the statuses left out of the totals, so the exclusion is explained where it applies. */
  excludedNote: string;
}

export const BUY_REPORT: WholesaleReportConfig = {
  reportTitle: "รายงานซื้อส่ง",
  fileStem: "รายงานซื้อส่ง",
  counterpartyHeader: "ผู้ขายส่ง",
  weightLabel: "น้ำหนักที่รับ",
  comparisonWeightLabel: "น้ำหนักที่สั่ง",
  averageLabel: "ราคาซื้อเฉลี่ย (บาท/บาททอง)",
  excludedNote: "ไม่รวมรายการที่ยกเลิก/ปฏิเสธ/ตีกลับ/คืนเงิน/ตัดหนี้สูญ",
};

export const SELL_REPORT: WholesaleReportConfig = {
  reportTitle: "รายงานขายส่ง",
  fileStem: "รายงานขายส่ง",
  counterpartyHeader: "ผู้รับซื้อส่ง",
  weightLabel: "น้ำหนักที่ตกลง",
  comparisonWeightLabel: "น้ำหนักที่ผู้ซื้อชั่งได้",
  averageLabel: "ราคาขายเฉลี่ย (บาท/บาททอง)",
  excludedNote: "ไม่รวมรายการที่ยกเลิก/ปฏิเสธ/ตีกลับ",
};

const COLUMN_WIDTHS = [14, 24, 16, 18, 18, 18, 18, 18, 14].map((width) => ({ width }));

const weightIn = (row: WholesaleExportRow, unit: ExportUnit) =>
  unit === "gb" ? row.weightGb : row.weightGm / 1000;

const comparisonIn = (row: WholesaleExportRow, unit: ExportUnit) => {
  if (row.comparisonWeightGb === null) return null;
  return unit === "gb" ? row.comparisonWeightGb : (row.comparisonWeightGm ?? 0) / 1000;
};

/**
 * The report's summary figures, over the rows that count.
 *
 * **The average is the summary line divided: total value (THB) over total volume (gold baht), for
 * the selected window.** Not a mean of the per-row prices — that would let a 1-baht order pull the
 * figure as hard as a 50-baht one, answering a question nobody asked. What the manager wants is
 * what the window's gold actually cost, or fetched, per baht.
 *
 * The denominator is **gold baht on both sheets**, including the kilogram one, and this is what
 * makes the report read correctly across purities. The business prices gold per gold baht, and one
 * gold baht of 99.9% is worth more than one gold baht of 96.5%. The kg→GB conversion is pure mass
 * (1 GB ≈ 15.244 g at any purity, `conversionFactor`), so the purity difference lives in the
 * *price*: `pricePerGb999 = pricePerGb965 × 99.9/96.5`. Dividing value by mass-GB therefore hands
 * back each sheet's own quote, and the 99.9% sheet reads higher than the 96.5% one — as it should.
 * Dividing the kilogram sheet by its kilogram total would instead print a THB/kg figure under a
 * THB/บาททอง heading and destroy the comparison.
 */
export function summarise(rows: WholesaleExportRow[], unit: ExportUnit) {
  const counted = rows.filter((r) => r.countsTowardTotal);
  const totalWeight = counted.reduce((sum, r) => sum + weightIn(r, unit), 0);
  const totalWeightGb = counted.reduce((sum, r) => sum + r.weightGb, 0);
  const totalAmount = counted.reduce((sum, r) => sum + r.amount, 0);
  return {
    counted: counted.length,
    excluded: rows.length - counted.length,
    totalWeight,
    totalAmount,
    /**
     * Null when there is no volume to divide by — an empty window, or one where every row was
     * cancelled. Not zero: a 0.00 in a price column reads as "the gold cost nothing", which is a
     * claim, where an absent average is the truth. `0/0` would of course print a literal NaN.
     */
    averagePricePerGb: totalWeightGb > 0 ? totalAmount / totalWeightGb : null,
  };
}

/**
 * The block under the title: the answer, before the reader reaches the rows that support it.
 *
 * Two columns rather than a wide table, so it reads as a caption and cannot be mistaken for the
 * data — and so nothing about it constrains the column widths the table below needs.
 */
function summaryBlock(
  summary: ReturnType<typeof summarise>,
  config: WholesaleReportConfig,
  unit: ExportUnit,
): SheetData {
  const excludedNote =
    summary.excluded > 0 ? `(${config.excludedNote} ${summary.excluded} รายการ)` : "";

  return [
    [bold("สรุป")],
    [text("จำนวนรายการ"), strong(count(summary.counted)), text(excludedNote)],
    [text(`${config.weightLabel}รวม ${unitSuffix(unit)}`), strong(weight(summary.totalWeight))],
    [text("ยอดรวม"), strong(money(summary.totalAmount))],
    [
      text(config.averageLabel),
      // an em dash rather than a blank, so "there is no average" reads as an answer instead of a
      // cell that failed to fill. Nothing sums this line, so text here costs no arithmetic.
      summary.averagePricePerGb === null
        ? bold("—")
        : strong(money(summary.averagePricePerGb)),
    ],
    [],
  ];
}

/**
 * How the report describes its own window.
 *
 * Both list pages let an operator clear either end of the date filter to open the range up, so a
 * missing bound is an ordinary state and not a mistake. `formatBusinessDate("")` returns an empty
 * string, which would leave the file claiming a window it does not have.
 */
export function windowLabel(from: string, to: string) {
  if (from && to) return `ตั้งแต่ ${formatBusinessDate(from)} ถึง ${formatBusinessDate(to)}`;
  if (from) return `ตั้งแต่ ${formatBusinessDate(from)} เป็นต้นไป`;
  if (to) return `ถึง ${formatBusinessDate(to)}`;
  return "ทุกช่วงเวลา";
}

export function buildWholesaleSheet(params: {
  rows: WholesaleExportRow[];
  unit: ExportUnit;
  config: WholesaleReportConfig;
  from: string;
  to: string;
  generatedAt: Date;
  generatedBy: string;
}): SheetData {
  const { rows, unit, config, from, to, generatedAt, generatedBy } = params;

  const header: Row = [
    headerCell("วันที่"),
    headerCell(config.counterpartyHeader),
    headerCell("ประเภททอง"),
    headerCell(`${config.weightLabel} ${unitSuffix(unit)}`, "right"),
    headerCell(`${config.comparisonWeightLabel} ${unitSuffix(unit)}`, "right"),
    headerCell("ราคา/บาททอง", "right"),
    headerCell("ยอดรวม", "right"),
    headerCell("สถานะ"),
    headerCell("นับในยอดรวม"),
  ];

  const body: SheetData = rows.map((row) => {
    const comparison = comparisonIn(row, unit);
    return [
      // Thai พ.ศ. text, as the screen renders it, so rows stay in the list's own order rather
      // than relying on a sort this column cannot support.
      text(formatBusinessDate(row.transactionDate)),
      text(row.counterparty),
      text(row.productType),
      weight(weightIn(row, unit)),
      comparison === null ? null : weight(comparison),
      money(row.pricePerGb),
      money(row.amount),
      text(row.status),
      text(row.countsTowardTotal ? "ใช่" : "ไม่"),
    ];
  });

  const summary = summarise(rows, unit);
  const footer: SheetData =
    rows.length > 0
      ? [
          [
            bold("รวม"),
            null,
            null,
            strong(weight(summary.totalWeight)),
            null,
            null,
            strong(money(summary.totalAmount)),
            null,
            null,
          ],
        ]
      : [];

  return [
    ...titleBlock(
      `${config.reportTitle} — ${SHEET_NAME[unit]}`,
      windowLabel(from, to),
      generatedAt,
      generatedBy,
    ),
    ...summaryBlock(summary, config, unit),
    header,
    ...(rows.length > 0 ? body : [emptyRow(header.length)]),
    ...footer,
  ];
}

// title block + the six-row summary block, then the header itself
const SUMMARY_BLOCK_ROWS = 6;
const STICKY_ROWS = TITLE_BLOCK_ROWS + SUMMARY_BLOCK_ROWS + 1;

export function buildWholesaleWorkbook(params: {
  nineSixFive: WholesaleExportRow[];
  nineNineNine: WholesaleExportRow[];
  config: WholesaleReportConfig;
  from: string;
  to: string;
  generatedAt: Date;
  generatedBy: string;
}): ExportSheet[] {
  const { nineSixFive, nineNineNine, ...rest } = params;
  // Both sheets always, empty or not — and each summarises only its own purity. There is no
  // combined figure anywhere in the file: 96.5% and 99.9% are separate pools priced in different
  // grades of gold, and an average spanning them would be an average of two different things.
  return (
    [
      ["gb", nineSixFive],
      ["kg", nineNineNine],
    ] as const
  ).map(([unit, rows]) => ({
    sheet: SHEET_NAME[unit],
    data: buildWholesaleSheet({ rows, unit, ...rest }),
    columns: COLUMN_WIDTHS,
    stickyRowsCount: STICKY_ROWS,
  }));
}

/** Names the file after whichever bounds the operator actually set — see `windowLabel`. */
export function wholesaleFileName(config: WholesaleReportConfig, from: string, to: string) {
  if (from && to) return `${config.fileStem}_${from}_ถึง_${to}.xlsx`;
  if (from) return `${config.fileStem}_ตั้งแต่_${from}.xlsx`;
  if (to) return `${config.fileStem}_ถึง_${to}.xlsx`;
  return `${config.fileStem}_ทั้งหมด.xlsx`;
}
