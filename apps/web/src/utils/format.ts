/** Money — always two decimals, thousands separated. */
export const formatNumber = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Weights render as entered: 2 kg is "2", not "2.000". The only cleanup is stripping binary
 * floating-point residue (a summed 0.1 + 0.2 would otherwise print 17 digits) — toPrecision(12)
 * is well inside a double's ~15 significant digits, so it never touches a real value.
 */
export const formatWeight = (n: number) => String(Number(n.toPrecision(12)));
