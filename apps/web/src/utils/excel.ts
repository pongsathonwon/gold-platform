import type { SheetData, Row } from "write-excel-file/browser";

/**
 * Shared spreadsheet primitives for every report the app exports.
 *
 * The rule these exist to enforce is that **a figure goes into a cell as a number, never as a
 * formatted string**. `formatNumber()` and `formatWeight()` are for the screen, and their output
 * ("1,234.00") is text as far as Excel is concerned — a column of it cannot be summed, which is
 * the first thing anyone does with an exported report. Presentation is a cell *format* instead;
 * the value stays a double.
 *
 * Domain-specific builders live beside their domain (`inventoryExport.ts`, `transactionExport.ts`)
 * and compose these.
 */

// --- number formats ---

export const MONEY = "#,##0.00";
export const WEIGHT = "#,##0.####";
// Deltas read as movement, so the sign is part of the presentation — the same reason the screen
// prints "+1,200.00". Two-section formats apply the first section to zero, which matches the
// pages' `delta >= 0` test.
export const SIGNED_MONEY = "+#,##0.00;-#,##0.00";
export const SIGNED_WEIGHT = "+#,##0.####;-#,##0.####";

const HEADER_FILL = "#F2F2F2";

/** 96.5% is measured in gold baht (บาท); 99.9% in kilograms. */
export type ExportUnit = "gb" | "kg";

export const SHEET_NAME: Record<ExportUnit, string> = { gb: "ทอง 96.5%", kg: "ทอง 99.9%" };

/** The unit suffix a weight column header carries, so no sheet has to state it twice. */
export const unitSuffix = (unit: ExportUnit) => (unit === "gb" ? "(บาท)" : "(กก.)");

/**
 * A sheet as `write-excel-file` wants it. Declared here rather than imported because the library's
 * own `Sheet` type is generic over its file-content representation, which nothing here needs to
 * know about; this is structurally assignable to it.
 */
export interface ExportSheet {
  sheet: string;
  data: SheetData;
  columns: { width: number }[];
  stickyRowsCount: number;
}

// --- cell helpers ---

export const text = (value: string): Row[number] => ({ value, type: String });
export const money = (value: number, format = MONEY): Row[number] => ({ value, type: Number, format });
export const weight = (value: number, format = WEIGHT): Row[number] => ({ value, type: Number, format });
export const count = (value: number): Row[number] => ({ value, type: Number, format: "#,##0" });
export const bold = (value: string): Row[number] => ({ value, type: String, fontWeight: "bold" });

/** The bold variant of any numeric cell, for footer and summary rows. */
export const strong = (cell: Row[number]): Row[number] => ({
  ...(cell as object),
  fontWeight: "bold",
});

export const headerCell = (value: string, align?: "left" | "right"): Row[number] => ({
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
export function titleBlock(
  title: string,
  window: string,
  generatedAt: Date,
  generatedBy: string,
): SheetData {
  return [
    [{ value: title, type: String, fontWeight: "bold", fontSize: 14 }],
    [text(window)],
    [text(`ออกรายงาน ${generatedAt.toLocaleString("th-TH")} โดย ${generatedBy}`)],
    [],
  ];
}

export const TITLE_BLOCK_ROWS = 4;

/** A section with no rows still gets a body, because a bare header reads as a loading failure. */
export const emptyRow = (columns: number): Row => [
  text("ไม่พบรายการ"),
  ...Array(columns - 1).fill(null),
];

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
