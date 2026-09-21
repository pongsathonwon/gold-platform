import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import type { SxProps, Theme } from "@mui/material";
import dayjs, { type Dayjs } from "dayjs";
import { AdapterDayjsBuddhist, THAI_LOCALE } from "../utils/buddhistAdapter";

/** The wire format every business date travels in — a ค.ศ. calendar day, no instant behind it. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const toDayjs = (isoDay: string): Dayjs | null => {
  if (!ISO_DAY.test(isoDay)) return null;
  const d = dayjs(isoDay);
  return d.isValid() ? d : null;
};

interface BusinessDatePickerProps {
  label: string;
  /** `YYYY-MM-DD` in ค.ศ., or `""` for no date. */
  value: string;
  /** Called with `YYYY-MM-DD` in ค.ศ., or `""` when the field is cleared. */
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
  required?: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}

/**
 * The one date field in the app: `dd/MM/yyyy`, Thai months, พ.ศ. year, keyboard or calendar.
 *
 * It reads and writes plain `YYYY-MM-DD` ค.ศ. strings so it drops into the places the native
 * `<input type="date">` used to sit without any call site learning about `Dayjs` or about the
 * era. Two things the native input could not do are why it is gone: it rendered `2026-09-21`
 * in whatever order the browser's locale felt like, and it would not take the พ.ศ. year an
 * operator reads off the paperwork in front of them. See `AdapterDayjsBuddhist` for the era.
 *
 * A half-typed date is swallowed rather than reported. The field holds the digits either way, so
 * nothing is lost on screen, but a list filter that re-queried on `21/09/2` would spend a round
 * trip on a window nobody asked for, and a form would flag a date the operator is mid-way through
 * typing. The value only leaves here once it is a real day — or once it is cleared, which is an
 * answer of its own: on the list filters an empty end opens that side of the window up.
 */
export function BusinessDatePicker({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  required,
  helperText,
  size,
  sx,
}: BusinessDatePickerProps) {
  return (
    // The calendar is configured here rather than once in `App.tsx`, against the usual rule about
    // where providers live (§7), and §6a is why: mounting it at the root drags MUI X, dayjs and the
    // Thai locale into the eager bundle, which measured +8.8 KB gzipped on cold load — paid in full
    // by the login screen, the one route everybody loads and the only one with no date on it. Down
    // here it rides along in this component's chunk, which is already lazy. The provider is context
    // and memoises its adapter, so a field per page costs nothing worth counting.
    <LocalizationProvider dateAdapter={AdapterDayjsBuddhist} adapterLocale={THAI_LOCALE}>
      <DatePicker
        label={label}
        format="DD/MM/YYYY"
        value={toDayjs(value)}
        onChange={(next) => {
          if (next === null) return onChange("");
          if (next.isValid()) onChange(next.format("YYYY-MM-DD"));
        }}
        minDate={minDate ? (toDayjs(minDate) ?? undefined) : undefined}
        maxDate={maxDate ? (toDayjs(maxDate) ?? undefined) : undefined}
        slotProps={{
          field: { clearable: true },
          textField: { required, helperText, size, sx },
        }}
      />
    </LocalizationProvider>
  );
}
