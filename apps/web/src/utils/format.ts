/** Money — always two decimals, thousands separated. */
export const formatNumber = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Weights render as entered: 2 kg is "2", not "2.000". The only cleanup is stripping binary
 * floating-point residue (a summed 0.1 + 0.2 would otherwise print 17 digits) — toPrecision(12)
 * is well inside a double's ~15 significant digits, so it never touches a real value.
 */
export const formatWeight = (n: number) => String(Number(n.toPrecision(12)));

/**
 * A business date (`YYYY-MM-DD`) as a Thai calendar date.
 *
 * Formatted from its own parts rather than through `new Date(...)`: a bare ISO date parses as UTC
 * midnight, which a browser west of Greenwich renders as the day before. The stored value is a
 * calendar day with no instant behind it, so no timezone should be applied to it at all.
 */
export const formatBusinessDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("th-TH");
};
