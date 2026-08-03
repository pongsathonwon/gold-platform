import { describe, expect, it } from "vitest";
import { WHOLE_BUY_STATUSES, WHOLE_BUY_TRANSITIONS, derivePricePerGb999 } from "@gold-platform/types";
import { countsTowardTotal, isTerminal, nextStatuses, requiresNote, statusLabel } from "./wholeBuyStatus";

describe("whole buy status machine", () => {
  it("walks the happy path to CHECKED", () => {
    expect(nextStatuses("CREATED")).toContain("CONFIRMED");
    expect(nextStatuses("CONFIRMED")).toContain("PAID");
    expect(nextStatuses("PAID")).toContain("RECEIVED");
    expect(nextStatuses("RECEIVED")).toContain("CHECKED");
  });

  it("treats CHECKED and every failure terminal as a dead end", () => {
    for (const status of ["CHECKED", "CANCELLED", "REJECTED", "RETURNED"]) {
      expect(nextStatuses(status)).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("keeps PAYMENT_FAILED and DISPUTED recoverable", () => {
    // a bounced transfer can be retried rather than killing the order
    expect(nextStatuses("PAYMENT_FAILED")).toContain("PAID");
    // a held shipment resolves either way
    expect(nextStatuses("DISPUTED")).toEqual(expect.arrayContaining(["CHECKED", "RETURNED"]));
    expect(isTerminal("PAYMENT_FAILED")).toBe(false);
    expect(isTerminal("DISPUTED")).toBe(false);
  });

  it("only reaches CHECKED from RECEIVED or DISPUTED — inventory moves nowhere else", () => {
    const entriesIntoChecked = Object.entries(WHOLE_BUY_TRANSITIONS)
      .filter(([, to]) => (to as string[]).includes("CHECKED"))
      .map(([from]) => from);
    expect(entriesIntoChecked.sort()).toEqual(["DISPUTED", "RECEIVED"]);
  });

  it("cannot cancel once the goods are paid for", () => {
    for (const status of ["PAID", "RECEIVED", "DISPUTED"]) {
      expect(nextStatuses(status)).not.toContain("CANCELLED");
    }
  });

  it("flags every failure branch as note-required and no happy-path step", () => {
    expect(requiresNote("CANCELLED")).toBe(true);
    expect(requiresNote("REJECTED")).toBe(true);
    expect(requiresNote("RETURNED")).toBe(true);
    expect(requiresNote("PAYMENT_FAILED")).toBe(true);
    expect(requiresNote("DISPUTED")).toBe(true);

    expect(requiresNote("CONFIRMED")).toBe(false);
    expect(requiresNote("PAID")).toBe(false);
    expect(requiresNote("CHECKED")).toBe(false);
  });

  it("gives every status a Thai label", () => {
    for (const status of WHOLE_BUY_STATUSES) {
      expect(statusLabel(status.value)).toBe(status.label);
      expect(statusLabel(status.value)).not.toBe(status.value);
    }
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(statusLabel("NOT_A_STATUS")).toBe("NOT_A_STATUS");
    expect(nextStatuses("NOT_A_STATUS")).toEqual([]);
  });
});

describe("list totals", () => {
  it("excludes orders that delivered nothing", () => {
    // these three are terminal failures — no gold arrived and no money settled
    expect(countsTowardTotal("CANCELLED")).toBe(false);
    expect(countsTowardTotal("REJECTED")).toBe(false);
    expect(countsTowardTotal("RETURNED")).toBe(false);
  });

  it("counts everything still in flight, plus checked", () => {
    for (const status of ["CREATED", "CONFIRMED", "PAID", "RECEIVED", "CHECKED"]) {
      expect(countsTowardTotal(status)).toBe(true);
    }
  });

  it("counts the recoverable failures — they can still complete", () => {
    expect(countsTowardTotal("PAYMENT_FAILED")).toBe(true);
    expect(countsTowardTotal("DISPUTED")).toBe(true);
  });

  it("excludes an unknown status rather than guessing", () => {
    expect(countsTowardTotal("NOT_A_STATUS")).toBe(false);
  });
});

describe("purity price derivation", () => {
  it("scales the 96.5% quote by the purity ratio", () => {
    expect(derivePricePerGb999(48250)).toBeCloseTo(48250 * (99.9 / 96.5), 2);
  });

  it("always quotes 99.9% above 96.5%", () => {
    expect(derivePricePerGb999(40000)).toBeGreaterThan(40000);
  });
});
