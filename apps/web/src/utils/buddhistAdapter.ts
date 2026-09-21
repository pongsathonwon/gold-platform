import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import type { Dayjs } from "dayjs";
// month and weekday names for the calendar; the era is this file's own doing, since dayjs's `th`
// locale still counts years in ค.ศ.
import "dayjs/locale/th";

export const THAI_LOCALE = "th";

/** พ.ศ. is ค.ศ. + 543. */
const BE_OFFSET = 543;

/**
 * A typed year at or above this is read as พ.ศ., below it as ค.ศ.
 *
 * The two eras cannot collide in practice: 2400 พ.ศ. is 1857 ค.ศ., so every ค.ศ. year this
 * business could mean (a transaction date, a birth year) sits well below the line and every
 * พ.ศ. year sits well above it. An operator who types 2569 and one who types 2026 both get
 * 21 September 2026 — which is the point, since the two habits coexist on Thai paperwork.
 */
const BE_THRESHOLD = 2400;

/**
 * Rewrites a format string so that dayjs prints the พ.ศ. year in place of the ค.ศ. one.
 *
 * The year is substituted into the format as a bracketed literal rather than by shifting the
 * date 543 years forward and formatting that: a shift moves 29 February onto a year that may
 * not have one, and dayjs would silently render the 28th. Bracketed runs in the incoming format
 * are already literals, so they are matched first and passed through untouched — otherwise a
 * `[YYYY]` someone escaped on purpose would be rewritten.
 */
const toBuddhistFormat = (value: Dayjs, format: string) => {
  const be = String(value.year() + BE_OFFSET);
  return format.replace(/\[[^\]]*\]|Y{2,4}/g, (token) => {
    if (token.startsWith("[")) return token;
    return token === "YY" ? `[${be.slice(-2)}]` : `[${be}]`;
  });
};

/**
 * `AdapterDayjs` with the Buddhist calendar bolted onto its two string boundaries.
 *
 * Only `formatByString` and `parse` are touched, so every date the pickers hold internally — and
 * every date they hand back to us — stays ค.ศ.. The era exists in the text the operator reads and
 * types, and nowhere else; `BusinessDatePicker` can therefore go on speaking plain `YYYY-MM-DD`.
 *
 * The overrides are installed in the constructor rather than declared as methods because MUI's
 * adapter defines its API as instance fields, which a subclass method would sit behind rather
 * than replace. Capturing the inherited implementations first also keeps `super` out of it.
 */
export class AdapterDayjsBuddhist extends AdapterDayjs {
  constructor(...args: ConstructorParameters<typeof AdapterDayjs>) {
    super(...args);

    const formatByString = this.formatByString;
    this.formatByString = (value, format) =>
      formatByString(value, toBuddhistFormat(value, format));

    const parse = this.parse;
    this.parse = (value, format) => {
      const parsed = parse(value, format);
      if (!parsed || !parsed.isValid()) return parsed;
      const year = parsed.year();
      return year >= BE_THRESHOLD ? parsed.year(year - BE_OFFSET) : parsed;
    };
  }
}
