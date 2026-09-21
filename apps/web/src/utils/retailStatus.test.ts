import { describe, it, expect } from "vitest";
import {
  buyCountsTowardTotal, buyNextStatuses, buyRequiresNote, buyStatusLabel,
  sellCountsTowardTotal, sellNextStatuses, sellRequiresNote, sellStatusLabel,
  statusColor,
} from "./retailStatus";

/**
 * These helpers are what the pages render buttons and totals from, so the properties worth pinning
 * are the ones a future change could quietly break: that the UI offers exactly two moves from a
 * confirmed record, that only the void demands a reason, that the stock-moving step is a dead end,
 * and that a voided trade leaves the totals.
 */

describe("what a write-up can do next", () => {
  it("offers putting the gold on the books, or voiding, on a confirmed record", () => {
    // The whole status machine, from the operator's side: one stock-moving step and the void.
    expect(buyNextStatuses("CONFIRMED")).toEqual(["STOCKED", "CANCELLED"]);
    expect(sellNextStatuses("CONFIRMED")).toEqual(["PACKED", "CANCELLED"]);
  });

  it("offers nothing once the gold has moved", () => {
    // A stocked buy is corrected through a manual stock loss, as a checked wholesale delivery is.
    // A packed sale waits for the hand-over states, which are not built — and neither is a return.
    expect(buyNextStatuses("STOCKED")).toEqual([]);
    expect(sellNextStatuses("PACKED")).toEqual([]);
  });

  it("offers nothing on a cancelled record", () => {
    expect(buyNextStatuses("CANCELLED")).toEqual([]);
    expect(sellNextStatuses("CANCELLED")).toEqual([]);
  });

  it("does not offer shipping on a retail sell", () => {
    // SHIPPED survives in the database enum so building it needs no migration, but it is reachable
    // from nothing — and the API refuses the move, so offering the button would be a dead end.
    expect(sellNextStatuses("CONFIRMED")).not.toContain("SHIPPED");
    expect(sellNextStatuses("PACKED")).not.toContain("SHIPPED");
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

  it("requires none to record a trade or move the gold", () => {
    expect(buyRequiresNote("CONFIRMED")).toBe(false);
    expect(sellRequiresNote("CONFIRMED")).toBe(false);
    expect(buyRequiresNote("STOCKED")).toBe(false);
    expect(sellRequiresNote("PACKED")).toBe(false);
  });
});

describe("what counts toward a list total", () => {
  it("counts a confirmed trade, whether or not the gold has moved yet", () => {
    // the trade happened either way; whether the metal is on the books is an inventory fact
    expect(buyCountsTowardTotal("CONFIRMED")).toBe(true);
    expect(sellCountsTowardTotal("CONFIRMED")).toBe(true);
    expect(buyCountsTowardTotal("STOCKED")).toBe(true);
    expect(sellCountsTowardTotal("PACKED")).toBe(true);
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
    // Unlike wholesale, where the rule inverts because a written-off balance reads differently by
    // direction, retail has no failure branch after the stock move — so nothing to disagree about.
    for (const status of ["DRAFT", "CONFIRMED", "CANCELLED"]) {
      expect(buyCountsTowardTotal(status)).toBe(sellCountsTowardTotal(status));
    }
  });
});

describe("labels and colours", () => {
  it("renders Thai labels", () => {
    expect(buyStatusLabel("CONFIRMED")).toBe("ยืนยันแล้ว");
    expect(buyStatusLabel("STOCKED")).toBe("เข้าสต๊อกแล้ว");
    expect(sellStatusLabel("PACKED")).toBe("เบิกทองออกจากสต๊อก");
    expect(sellStatusLabel("CANCELLED")).toBe("ยกเลิก");
  });

  it("falls back to the raw value for an unknown status", () => {
    // a bare code is ugly but truthful; inventing a label would hide that the build is behind
    expect(buyStatusLabel("NOT_A_STATUS")).toBe("NOT_A_STATUS");
    expect(statusColor("NOT_A_STATUS")).toBe("default");
  });

  it("saves green for gold that reached the vault, as wholesale does", () => {
    // a confirmed write-up is now a step on the way: the trade is recorded, the metal has not moved
    expect(statusColor("CONFIRMED")).toBe("info");
    expect(statusColor("STOCKED")).toBe("success");
    expect(statusColor("PACKED")).toBe("info");
    expect(statusColor("CANCELLED")).toBe("error");
  });
});
