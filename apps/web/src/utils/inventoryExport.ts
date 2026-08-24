import type { SheetData, Row } from "write-excel-file/browser";
import { formatBusinessDate } from "./format";
import { weightOf, wacRate, type VolumeRow, type MovementOpening, type WithCumulative } from "./inventoryVolume";

/**
 * Workbook builders for the two inventory reports.
 *
 * Everything here is pure: rows in, cell arrays out. The one rule worth stating is that **a
 * figure goes into a cell as a number, never as a formatted string**. `formatNumber()` and
 * `formatWeight()` exist for the screen, and their output ("1,234.00") is text as far as Excel is
 * concerned — a column of it cannot be summed, which is the first thing anyone does with an
 * exported ledger. Presentation is a cell *format* instead; the value stays a double.
 */

// --- number formats ---

const MONEY = "#,##0.00";
const WEIGHT = "#,##0.####";
// Deltas read as movement, so the sign is part of the presentation — the same reason the screen
// prints "+1,200.00". Two-section formats apply the first section to zero, which matches the
// page's `delta >= 0` test.
const SIGNED_MONEY = "+#,##0.00;-#,##0.00";
const SIGNED_WEIGHT = "+#,##0.####;-#,##0.####";

const HEADER_FILL = "#F2F2F2";

// 96.5% is measured in gold baht (บาท); 99.9% in kilograms
export type ExportUnit = "gb" | "kg";

/**
 * A sheet as `write-excel-file` wants it. Declared locally rather than imported because the
 * library's own `Sheet` type is generic over its file-content representation, which nothing here
 * needs to know about; this is structurally assignable to it.
 */
export interface ExportSheet {
  sheet: string;
  data: SheetData;
  columns: { width: number }[];
  stickyRowsCount: number;
}

/**
 * Master-data lookups, passed in as functions.
 *
 * The pages already hold these maps for their own rendering, and keeping the resolution outside
 * the builders is what lets the builders be tested with no master data at all.
 */
export interface ExportLabels {
  /**
   * The first column. It holds a different fact per sheet: 96.5% pools are keyed by brand, 99.9%
   * pools by origin — `brandId` is the `'NA'` sentinel there and would tell the reader nothing.
   */
  pool: (row: { brandId: string; origin: string }, unit: ExportUnit) => string;
  productType: (productTypeId: string) => string;
  referenceType: (referenceType: string) => string;
}

const poolHeader = (unit: ExportUnit) => (unit === "gb" ? "แบรน" : "ที่มา");
const weightHeader = (unit: ExportUnit) => (unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)");
const balanceHeader = (unit: ExportUnit) =>
  unit === "gb" ? "คงเหลือสะสม (บาท)" : "คงเหลือสะสม (กก.)";

const SHEET_NAME: Record<ExportUnit, string> = { gb: "ทอง 96.5%", kg: "ทอง 99.9%" };

// --- shared cell helpers ---

const text = (value: string): Row[number] => ({ value, type: String });
const money = (value: number, format = MONEY): Row[number] => ({ value, type: Number, format });
const weight = (value: number, format = WEIGHT): Row[number] => ({ value, type: Number, format });
const bold = (value: string): Row[number] => ({ value, type: String, fontWeight: "bold" });

const headerCell = (value: string, align?: "left" | "right"): Row[number] => ({
  value,
  type: String,
  fontWeight: "bold",
  backgroundColor: HEADER_FILL,
  align,
});

/**
 * Rows 1–4 of every sheet: what the report is, what window it covers, and who pulled it when.
 *
 * A spreadsheet outlives the screen it was taken from — once the file is on someone's desktop the
 * date range is not recoverable from the rows, so it has to be written down. Deliberately not
 * merged: merged cells break sorting and filtering for everything below them, and the title reads
 * fine sitting in column A.
 */
function titleBlock(title: string, window: string, generatedAt: Date, generatedBy: string): SheetData {
  return [
    [{ value: title, type: String, fontWeight: "bold", fontSize: 14 }],
    [text(window)],
    [text(`ออกรายงาน ${generatedAt.toLocaleString("th-TH")} โดย ${generatedBy}`)],
    [],
  ];
}

/** Rows before the table header — the title block plus the header row itself. */
const STICKY_ROWS = 5;

const EMPTY_ROW = (columns: number): Row => [text("ไม่พบรายการ"), ...Array(columns - 1).fill(null)];

// --- balance report ---

const BALANCE_WIDTHS = [18, 16, 16, 18, 22].map((width) => ({ width }));

export function buildBalanceSheet(params: {
  rows: VolumeRow[];
  unit: ExportUnit;
  labels: ExportLabels;
  asOf: string;
  generatedAt: Date;
  generatedBy: string;
}): SheetData {
  const { rows, unit, labels, asOf, generatedAt, generatedBy } = params;

  const header: Row = [
    headerCell(poolHeader(unit)),
    headerCell("ประเภททอง"),
    headerCell(weightHeader(unit), "right"),
    headerCell("มูลค่า", "right"),
    headerCell("ราคาเฉลี่ย (บาท/บาททอง)", "right"),
  ];

  const body: SheetData = rows.map((row) => [
    text(labels.pool(row, unit)),
    text(labels.productType(row.productTypeId)),
    weight(weightOf(row, unit)),
    money(row.totalCost ?? 0),
    money(wacRate(row)),
  ]);

  // Both sections average per **gold baht**, including the kilogram one — that is what the column
  // header says and what every row above it shows. Dividing by the kg total would print a
  // THB/kg figure under a THB/บาททอง heading.
  const totalWeightGb = rows.reduce((sum, r) => sum + r.totalWeightGb, 0);
  const totalCost = rows.reduce((sum, r) => sum + (r.totalCost ?? 0), 0);
  const footer: SheetData =
    rows.length > 0
      ? [
          [
            bold("รวม"),
            null,
            { ...weight(rows.reduce((sum, r) => sum + weightOf(r, unit), 0)), fontWeight: "bold" },
            { ...money(totalCost), fontWeight: "bold" },
            { ...money(totalWeightGb > 0 ? totalCost / totalWeightGb : 0), fontWeight: "bold" },
          ],
        ]
      : [];

  return [
    ...titleBlock(
      `คลังทองคำแท่ง — ${SHEET_NAME[unit]}`,
      `ยอด ณ วันที่ ${formatBusinessDate(asOf)}`,
      generatedAt,
      generatedBy,
    ),
    header,
    ...(rows.length > 0 ? body : [EMPTY_ROW(header.length)]),
    ...footer,
  ];
}

export function buildBalanceWorkbook(params: {
  nineSixFive: VolumeRow[];
  nineNineNine: VolumeRow[];
  labels: ExportLabels;
  asOf: string;
  generatedAt: Date;
  generatedBy: string;
}): ExportSheet[] {
  const { nineSixFive, nineNineNine, ...rest } = params;
  // Both sheets are always emitted, empty or not: a workbook missing ทอง 99.9% reads as a broken
  // export rather than as a purity nobody holds today.
  return (
    [
      ["gb", nineSixFive],
      ["kg", nineNineNine],
    ] as const
  ).map(([unit, rows]) => ({
    sheet: SHEET_NAME[unit],
    data: buildBalanceSheet({ rows, unit, ...rest }),
    columns: BALANCE_WIDTHS,
    stickyRowsCount: STICKY_ROWS,
  }));
}

// --- movement report ---

const MOVEMENT_WIDTHS = [14, 18, 16, 20, 16, 18, 20, 16, 30].map((width) => ({ width }));

/**
 * The movement fields the export reads. Structurally a subset of the page's row, so the page can
 * hand its own rows over unchanged.
 */
export type ExportMovementRow = WithCumulative<{
  purityId: string;
  brandId: string;
  origin: string;
  productTypeId: string;
  referenceType: string;
  weightGbDelta: number;
  weightGmDelta: number;
  costDelta: number;
  movementDate: string;
  movedBy: string;
  notes: string | null;
}>;

/**
 * A section's opening balance, in that section's own unit.
 *
 * `opening` arrives per purity — the sum of every delta strictly before the window — so a section
 * spanning more than one purity id sums them. Without this the `คงเหลือสะสม` column starts at a
 * number the reader cannot derive from anything else in the file.
 */
export function sectionOpening(
  opening: MovementOpening[],
  belongsToSection: (purityId: string) => boolean,
  unit: ExportUnit,
): number {
  return opening
    .filter((o) => belongsToSection(o.purityId))
    .reduce((sum, o) => sum + (unit === "gb" ? o.weightGb : o.weightGm / 1000), 0);
}

export function buildMovementSheet(params: {
  rows: ExportMovementRow[];
  unit: ExportUnit;
  opening: number;
  labels: ExportLabels;
  from: string;
  to: string;
  generatedAt: Date;
  generatedBy: string;
}): SheetData {
  const { rows, unit, opening, labels, from, to, generatedAt, generatedBy } = params;

  const deltaOf = (r: ExportMovementRow) => (unit === "gb" ? r.weightGbDelta : r.weightGmDelta / 1000);
  const balanceOf = (r: ExportMovementRow) =>
    unit === "gb" ? r.cumulativeWeightGb : r.cumulativeWeightGm / 1000;

  const header: Row = [
    headerCell("วันที่"),
    headerCell(poolHeader(unit)),
    headerCell("ประเภททอง"),
    headerCell("ประเภทรายการ"),
    headerCell(weightHeader(unit), "right"),
    headerCell("มูลค่า", "right"),
    headerCell(balanceHeader(unit), "right"),
    headerCell("บันทึกโดย"),
    headerCell("หมายเหตุ"),
  ];

  // The balance carried into the window. Emitted even when the window itself is empty — "nothing
  // moved, and here is what you were holding" is a complete answer.
  const openingRow: Row = [
    bold("ยอดยกมา"),
    null,
    null,
    null,
    null,
    null,
    { ...weight(opening), fontWeight: "bold" },
    null,
    null,
  ];

  const body: SheetData = rows.map((row) => [
    // Thai Buddhist-era text, exactly as the screen shows it. Excel cannot render พ.ศ. on a real
    // date value, so this is text — which is why the rows stay in the API's ascending
    // (movementDate, movedAt, id) order: the reader gets chronology from the row order, since
    // sorting this column would order it lexically.
    text(formatBusinessDate(row.movementDate)),
    text(labels.pool(row, unit)),
    text(labels.productType(row.productTypeId)),
    text(labels.referenceType(row.referenceType)),
    weight(deltaOf(row), SIGNED_WEIGHT),
    money(row.costDelta, SIGNED_MONEY),
    weight(balanceOf(row)),
    text(row.movedBy),
    text(row.notes ?? ""),
  ]);

  const footer: SheetData =
    rows.length > 0
      ? [
          [
            bold("รวม / คงเหลือ"),
            null,
            null,
            null,
            {
              ...weight(rows.reduce((sum, r) => sum + deltaOf(r), 0), SIGNED_WEIGHT),
              fontWeight: "bold",
            },
            {
              ...money(rows.reduce((sum, r) => sum + r.costDelta, 0), SIGNED_MONEY),
              fontWeight: "bold",
            },
            // rows are oldest-first, so the window's closing balance is the last row's cumulative
            { ...weight(balanceOf(rows[rows.length - 1])), fontWeight: "bold" },
            null,
            null,
          ],
        ]
      : [];

  return [
    ...titleBlock(
      `ความเคลื่อนไหวทองแท่ง — ${SHEET_NAME[unit]}`,
      `ตั้งแต่ ${formatBusinessDate(from)} ถึง ${formatBusinessDate(to)}`,
      generatedAt,
      generatedBy,
    ),
    header,
    openingRow,
    ...(rows.length > 0 ? body : [EMPTY_ROW(header.length)]),
    ...footer,
  ];
}

export function buildMovementWorkbook(params: {
  nineSixFive: ExportMovementRow[];
  nineNineNine: ExportMovementRow[];
  openingGb: number;
  openingKg: number;
  labels: ExportLabels;
  from: string;
  to: string;
  generatedAt: Date;
  generatedBy: string;
}): ExportSheet[] {
  const { nineSixFive, nineNineNine, openingGb, openingKg, ...rest } = params;
  return (
    [
      ["gb", nineSixFive, openingGb],
      ["kg", nineNineNine, openingKg],
    ] as const
  ).map(([unit, rows, opening]) => ({
    sheet: SHEET_NAME[unit],
    data: buildMovementSheet({ rows, unit, opening, ...rest }),
    columns: MOVEMENT_WIDTHS,
    stickyRowsCount: STICKY_ROWS + 1, // the opening row rides along with the header
  }));
}

// --- file names ---

export const balanceFileName = (asOf: string) => `คลังทองคำแท่ง_${asOf}.xlsx`;
export const movementFileName = (from: string, to: string) =>
  `ความเคลื่อนไหวทองแท่ง_${from}_ถึง_${to}.xlsx`;

/**
 * Writes the workbook and hands it to the browser.
 *
 * The library is pulled in on the click rather than at module load — it is ~50 KB that only
 * matters to someone who actually exports, and the initial bundle is paid for by everyone.
 * Serialization is synchronous, so callers should disable the control while this runs.
 */
export async function downloadWorkbook(sheets: ExportSheet[], fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  await writeXlsxFile(sheets).toFile(fileName);
}
