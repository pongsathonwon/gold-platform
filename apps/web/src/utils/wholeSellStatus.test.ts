import { describe, expect, it } from "vitest";
import {
  WHOLE_SELL_EXCLUDED_FROM_TOTALS, WHOLE_SELL_INVENTORY_STATUS, WHOLE_SELL_REVERSAL_STATUS,
  WHOLE_SELL_STATUSES, WHOLE_SELL_TRANSITIONS,
} from "@gold-platform/types";
import {
  countsTowardTotal, isTerminal, nextStatuses, requiresNote, statusLabel, statusMeta,
} from "./wholeSellStatus";

describe("whole sell status machine", () => {
  it("walks the happy path to PAID", () => {
    expect(nextStatuses("CREATED")).toContain("CONFIRMED");
    expect(nextStatuses("CONFIRMED")).toContain("PACKED");
    expect(nextStatuses("PACKED")).toContain("SHIPPED");
    expect(nextStatuses("SHIPPED")).toContain("PAID");
  });

  it("treats PAID and every failure terminal as a dead end", () => {
    for (const status of ["PAID", "CANCELLED", "REJECTED", "RETURNED", "WRITTEN_OFF"]) {
      expect(nextStatuses(status)).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("keeps DISPUTED and PAYMENT_FAILED recoverable", () => {
    // a contested weight settles into a payment or a return
    expect(nextStatuses("DISPUTED")).toEqual(expect.arrayContaining(["PAID", "RETURNED"]));
    // a bounced transfer can be chased rather than killing the deal
    expect(nextStatuses("PAYMENT_FAILED")).toContain("PAID");
    expect(isTerminal("DISPUTED")).toBe(false);
    expect(isTerminal("PAYMENT_FAILED")).toBe(false);
  });

  it("decrements at PACKED and nowhere else", () => {
    expect(WHOLE_SELL_INVENTORY_STATUS).toBe("PACKED");
    const entriesIntoPacked = Object.entries(WHOLE_SELL_TRANSITIONS)
      .filter(([, to]) => (to as string[]).includes("PACKED"))
      .map(([from]) => from);
    // only one way in, so the decrement cannot fire twice on one transaction
    expect(entriesIntoPacked).toEqual(["CONFIRMED"]);
  });

  it("routes every post-decrement state that can still come home to RETURNED", () => {
    expect(WHOLE_SELL_REVERSAL_STATUS).toBe("RETURNED");
    const entriesIntoReturned = Object.entries(WHOLE_SELL_TRANSITIONS)
      .filter(([, to]) => (to as string[]).includes("RETURNED"))
      .map(([from]) => from);
    expect(entriesIntoReturned.sort()).toEqual(["DISPUTED", "PACKED", "SHIPPED"]);
  });

  it("never reaches RETURNED from a state that has not decremented yet", () => {
    // reversing a decrement that never happened would invent stock out of nothing
    for (const status of ["CREATED", "CONFIRMED"]) {
      expect(nextStatuses(status)).not.toContain("RETURNED");
    }
  });

  it("can be cancelled up to the point gold leaves the vault, and not after", () => {
    // matches wholesale-buy: nothing has moved while CREATED or CONFIRMED, so our own mistakes
    // exit as CANCELLED rather than being misreported as the buyer walking away. Once PACKED has
    // decremented, the exit is RETURNED — a physical event — not a cancellation.
    for (const status of ["CREATED", "CONFIRMED"]) {
      expect(nextStatuses(status)).toContain("CANCELLED");
    }
    for (const status of ["PACKED", "SHIPPED", "DISPUTED", "PAYMENT_FAILED"]) {
      expect(nextStatuses(status)).not.toContain("CANCELLED");
    }
  });

  it("stops offering RETURNED once the buyer has kept the gold and stiffed us", () => {
    // PAYMENT_FAILED means they have both the gold and our invoice — write it off, don't pretend
    // the shipment can come back
    expect(nextStatuses("PAYMENT_FAILED")).toEqual(expect.arrayContaining(["PAID", "WRITTEN_OFF"]));
    expect(nextStatuses("PAYMENT_FAILED")).not.toContain("RETURNED");
  });

  it("gives an unpaid delivery a terminal exit", () => {
    // without WRITTEN_OFF a non-paying buyer would sit in PAYMENT_FAILED forever
    expect(nextStatuses("PAYMENT_FAILED")).toContain("WRITTEN_OFF");
  });

  it("flags every failure branch as note-required and no happy-path step", () => {
    for (const status of ["DISPUTED", "PAYMENT_FAILED", "CANCELLED", "REJECTED", "RETURNED", "WRITTEN_OFF"]) {
      expect(requiresNote(status)).toBe(true);
    }
    for (const status of ["CREATED", "CONFIRMED", "PACKED", "SHIPPED", "PAID"]) {
      expect(requiresNote(status)).toBe(false);
    }
  });

  it("gives every status a Thai label", () => {
    for (const status of WHOLE_SELL_STATUSES) {
      expect(statusLabel(status.value)).toBe(status.label);
      expect(statusLabel(status.value)).not.toBe(status.value);
    }
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(statusLabel("NOT_A_STATUS")).toBe("NOT_A_STATUS");
    expect(nextStatuses("NOT_A_STATUS")).toEqual([]);
  });

  // the same cross-check the buy side carries: `terminal` and the transition map are two
  // separately-maintained facts, so changing a status's terminality is a two-place edit and a
  // half-done one has to fail here rather than downstream in a totals helper
  it.each(WHOLE_SELL_STATUSES)(
    "$value: the terminal flag agrees with the transition map",
    ({ value, terminal }) => {
      expect(WHOLE_SELL_TRANSITIONS[value].length === 0).toBe(terminal);
    },
  );

  // The rule here is *did the gold end up gone*, which is why WRITTEN_OFF counts on a sell and
  // not on a buy. It must never be re-derived from `terminal`.
  it.each(WHOLE_SELL_EXCLUDED_FROM_TOTALS)("%s is a real status excluded from totals", (value) => {
    expect(WHOLE_SELL_STATUSES.map((s) => s.value)).toContain(value);
    expect(countsTowardTotal(value)).toBe(false);
    expect(statusMeta(value)?.kind).toBe("bad");
  });
});

describe("list totals", () => {
  it("excludes deals where no gold ever moved", () => {
    expect(countsTowardTotal("CANCELLED")).toBe(false);
    expect(countsTowardTotal("REJECTED")).toBe(false);
  });

  it("excludes a returned deal — the decrement was reversed, so net stock is unchanged", () => {
    expect(countsTowardTotal("RETURNED")).toBe(false);
  });

  it("counts a written-off deal — the gold left and nothing brought it back", () => {
    // the one terminal failure with no reversal; excluding it would make the weight column
    // disagree with the movement ledger
    expect(countsTowardTotal("WRITTEN_OFF")).toBe(true);
  });

  it("counts everything still in flight, plus paid", () => {
    for (const status of ["CREATED", "CONFIRMED", "PACKED", "SHIPPED", "PAID"]) {
      expect(countsTowardTotal(status)).toBe(true);
    }
  });

  it("counts the recoverable failures — they can still complete", () => {
    expect(countsTowardTotal("DISPUTED")).toBe(true);
    expect(countsTowardTotal("PAYMENT_FAILED")).toBe(true);
  });

  it("excludes an unknown status rather than guessing", () => {
    expect(countsTowardTotal("NOT_A_STATUS")).toBe(false);
  });
});
