import { describe, it, expect } from "vitest";
import {
  buyCountsTowardTotal, buyNextStatuses, buyRequiresNote, buyStatusLabel,
  sellCountsTowardTotal, sellNextStatuses, sellRequiresNote, sellStatusLabel,
  statusColor,
} from "./retailStatus";

/**
 * These helpers are what the pages render buttons and totals from, so the properties worth pinning
 * are the ones a future change could quietly break: that the UI offers exactly one move, that the
 * move it offers demands a reason, and that a voided trade leaves the totals.
 */

describe("what a write-up can do next", () => {
  it("offers voiding, and only voiding, on a confirmed record", () => {
    // The whole status machine, from the operator's side. Anything more would be a state a counter
    // trade does not pass through.
    expect(buyNextStatuses("CONFIRMED")).toEqual(["CANCELLED"]);
    expect(sellNextStatuses("CONFIRMED")).toEqual(["CANCELLED"]);
  });

  it("offers nothing on a cancelled record", () => {
    expect(buyNextStatuses("CANCELLED")).toEqual([]);
    expect(sellNextStatuses("CANCELLED")).toEqual([]);
  });

  it("does not offer shipping on a retail sell", () => {
    // SHIPPED survives in the database enum so restoring it needs no migration, but it is reachable
    // from nothing — and the API refuses the move, so offering the button would be a dead end.
    expect(sellNextStatuses("CONFIRMED")).not.toContain("SHIPPED");
    expect(sellNextStatuses("SHIPPED")).toEqual([]);
  });

  it("returns nothing for a status it does not recognise", () => {
    expect(buyNextStatuses("NOT_A_STATUS")).toEqual([]);
  });
});

describe("when a reason is demanded", () => {
  it("requires one to void", () => {
    // the API rejects a void without a note; the dialog has to collect it or the operator meets a
    // 422 they could not have anticipated
    expect(buyRequiresNote("CANCELLED")).toBe(true);
    expect(sellRequiresNote("CANCELLED")).toBe(true);
  });

  it("requires none to record a trade", () => {
    expect(buyRequiresNote("CONFIRMED")).toBe(false);
    expect(sellRequiresNote("CONFIRMED")).toBe(false);
  });
});

describe("what counts toward a list total", () => {
  it("counts a confirmed trade", () => {
    expect(buyCountsTowardTotal("CONFIRMED")).toBe(true);
    expect(sellCountsTowardTotal("CONFIRMED")).toBe(true);
  });

  it("excludes a cancelled one", () => {
    // it did not happen, so it cannot inform what gold cost or fetched — though it stays visible
    // in the table, with the exclusion stated in the footer
    expect(buyCountsTowardTotal("CANCELLED")).toBe(false);
    expect(sellCountsTowardTotal("CANCELLED")).toBe(false);
  });

  it("excludes a status it does not recognise", () => {
    // an unknown status is a row this build does not understand; counting it would put an
    // unexplained figure into an average the manager acts on
    expect(buyCountsTowardTotal("NOT_A_STATUS")).toBe(false);
    expect(sellCountsTowardTotal("NOT_A_STATUS")).toBe(false);
  });

  it("reads the same on both sides", () => {
    // Unlike wholesale, where the rule inverts because the gold moves the other way, retail books
    // no stock at all — so there is nothing for the two domains to disagree about.
    for (const status of ["DRAFT", "CONFIRMED", "CANCELLED"]) {
      expect(buyCountsTowardTotal(status)).toBe(sellCountsTowardTotal(status));
    }
  });
});

describe("labels and colours", () => {
  it("renders Thai labels", () => {
    expect(buyStatusLabel("CONFIRMED")).toBe("ยืนยันแล้ว");
    expect(sellStatusLabel("CANCELLED")).toBe("ยกเลิก");
  });

  it("falls back to the raw value for an unknown status", () => {
    // a bare code is ugly but truthful; inventing a label would hide that the build is behind
    expect(buyStatusLabel("NOT_A_STATUS")).toBe("NOT_A_STATUS");
    expect(statusColor("NOT_A_STATUS")).toBe("default");
  });

  it("reads a confirmed write-up as finished, not in flight", () => {
    // wholesale saves green for gold that reached the vault; a retail record has no later milestone
    expect(statusColor("CONFIRMED")).toBe("success");
    expect(statusColor("CANCELLED")).toBe("error");
  });
});
