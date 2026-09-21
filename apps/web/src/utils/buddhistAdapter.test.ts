import { describe, it, expect } from "vitest";
import { AdapterDayjsBuddhist, THAI_LOCALE } from "./buddhistAdapter";

const adapter = new AdapterDayjsBuddhist({ locale: THAI_LOCALE });

const iso = (value: unknown) => (value as { format: (f: string) => string }).format("YYYY-MM-DD");

describe("AdapterDayjsBuddhist", () => {
  describe("reads both eras", () => {
    // The whole point of the field: the operator types whichever year is on the paper in front of
    // them and lands on the same day either way.
    it("takes a พ.ศ. year", () => {
      expect(iso(adapter.parse("21/09/2569", "DD/MM/YYYY"))).toBe("2026-09-21");
    });

    it("takes a ค.ศ. year", () => {
      expect(iso(adapter.parse("21/09/2026", "DD/MM/YYYY"))).toBe("2026-09-21");
    });

    it("parses the separator-less form the field edits in", () => {
      // `getDateFromDateSections` joins the sections with spaces rather than the display separator
      expect(iso(adapter.parse("21 09 2569", "DD MM YYYY"))).toBe("2026-09-21");
    });

    it("passes an unparseable value through rather than inventing a date", () => {
      expect(adapter.parse("", "DD/MM/YYYY")).toBeNull();
      expect(adapter.isValid(adapter.parse("21/09/25", "DD/MM/YYYY"))).toBe(false);
    });
  });

  describe("writes พ.ศ.", () => {
    const date = adapter.parse("21/09/2026", "DD/MM/YYYY")!;

    it("renders the year the operator expects", () => {
      expect(adapter.formatByString(date, "DD/MM/YYYY")).toBe("21/09/2569");
      expect(adapter.formatByString(date, "YY")).toBe("69");
    });

    it("leaves a format with no year alone", () => {
      expect(adapter.formatByString(date, "DD/MM")).toBe("21/09");
    });

    it("does not rewrite an escaped literal", () => {
      expect(adapter.formatByString(date, "[YYYY] YYYY")).toBe("YYYY 2569");
    });

    it("puts a Thai month in the calendar header", () => {
      expect(adapter.formatByString(date, "MMMM YYYY")).toBe("กันยายน 2569");
    });

    // The era is applied by substituting the year into the format, not by shifting the date 543
    // years forward — a shift would land 29 February on a year without one and quietly print the
    // 28th. 2024-02-29 is exactly that case: พ.ศ. 2567 is not a leap year in the proleptic
    // Gregorian calendar dayjs would be doing the arithmetic in.
    it("keeps a leap day on the day it fell", () => {
      const leapDay = adapter.parse("29/02/2024", "DD/MM/YYYY")!;
      expect(adapter.formatByString(leapDay, "DD/MM/YYYY")).toBe("29/02/2567");
    });
  });

  describe("round-trips", () => {
    // What the field does on every keystroke: re-read its own rendering. A mismatch here is a date
    // that changes by 543 years each time the operator tabs through it.
    it("re-reads what it wrote", () => {
      const date = adapter.parse("21/09/2026", "DD/MM/YYYY")!;
      const shown = adapter.formatByString(date, "DD/MM/YYYY");
      expect(iso(adapter.parse(shown, "DD/MM/YYYY"))).toBe("2026-09-21");
    });

    it("compares years on the rendered value without drifting", () => {
      const a = adapter.parse("01/01/2026", "DD/MM/YYYY")!;
      const b = adapter.parse("31/12/2026", "DD/MM/YYYY")!;
      expect(adapter.isSameYear(a, b)).toBe(true);
      expect(adapter.isSameYear(a, adapter.parse("01/01/2027", "DD/MM/YYYY")!)).toBe(false);
    });
  });
});
