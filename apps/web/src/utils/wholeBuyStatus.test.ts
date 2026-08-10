import { describe, expect, it } from "vitest";
import {
  WHOLE_BUY_EXCLUDED_FROM_TOTALS, WHOLE_BUY_STATUSES,
  WHOLE_BUY_TRANSITIONS, derivePricePerGb999,
} from "@gold-platform/types";
import {
  countsTowardTotal, formatWeight, isTerminal, nextStatuses, requiresNote, statusLabel, statusMeta,
} from "./wholeBuyStatus";

describe("whole buy status machine", () => {
  it("walks the happy path to STOCKED", () => {
    expect(nextStatuses("CREATED")).toContain("CONFIRMED");
    expect(nextStatuses("CONFIRMED")).toContain("PAID");
    expect(nextStatuses("PAID")).toContain("RECEIVED");
    expect(nextStatuses("RECEIVED")).toContain("STOCKED");
  });

  it("treats STOCKED and every failure terminal as a dead end", () => {
    for (const status of ["STOCKED", "CANCELLED", "REJECTED", "REFUNDED", "WRITTEN_OFF"]) {
      expect(nextStatuses(status)).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("lets a delivery be refused at the door without taking custody", () => {
    // weight, brand or purity disagreeing with the document is not a discrepancy to negotiate —
    // it is the wrong goods, and we never sign for them
    expect(nextStatuses("PAID")).toContain("RETURNED");
  });

  it("keeps a return open until the money is accounted for", () => {
    // our cash left at PAID, so a shipment going back leaves the supplier holding it. RETURNED
    // used to be terminal, which closed the transaction with the loss unrecorded anywhere.
    expect(isTerminal("RETURNED")).toBe(false);
    expect(nextStatuses("RETURNED")).toEqual(
      expect.arrayContaining(["REFUNDED", "RECEIVED", "WRITTEN_OFF"]),
    );
  });

  it("sends gold back only through DISPUTED once custody has transferred", () => {
    // RECEIVED means it was correct at the door; changing our mind afterwards has to record the
    // reason and the contested weight, which is what DISPUTED is for
    expect(nextStatuses("RECEIVED")).not.toContain("RETURNED");
    expect(nextStatuses("DISPUTED")).toContain("RETURNED");
  });

  it("gives a paid order that never arrives a way out", () => {
    // the mirror of the sell side's SHIPPED → PAYMENT_FAILED → WRITTEN_OFF: without this,
    // a supplier who took our money and never shipped stranded the order at PAID forever
    expect(nextStatuses("PAID")).toContain("DELIVERY_FAILED");
    // the goods may still turn up, or we give up on them
    expect(nextStatuses("DELIVERY_FAILED")).toEqual(expect.arrayContaining(["RECEIVED", "WRITTEN_OFF"]));
    expect(isTerminal("DELIVERY_FAILED")).toBe(false);
  });

  it("will not cancel a delivery failure — our money already moved", () => {
    expect(nextStatuses("DELIVERY_FAILED")).not.toContain("CANCELLED");
  });

  it("keeps PAYMENT_FAILED and DISPUTED recoverable", () => {
    // a bounced transfer can be retried rather than killing the order
    expect(nextStatuses("PAYMENT_FAILED")).toContain("PAID");
    // a held shipment resolves either way
    expect(nextStatuses("DISPUTED")).toEqual(expect.arrayContaining(["STOCKED", "RETURNED"]));
    expect(isTerminal("PAYMENT_FAILED")).toBe(false);
    expect(isTerminal("DISPUTED")).toBe(false);
  });

  it("only reaches STOCKED from RECEIVED or DISPUTED — inventory moves nowhere else", () => {
    const entriesIntoStocked = Object.entries(WHOLE_BUY_TRANSITIONS)
      .filter(([, to]) => (to as string[]).includes("STOCKED"))
      .map(([from]) => from);
    expect(entriesIntoStocked.sort()).toEqual(["DISPUTED", "RECEIVED"]);
  });

  it("cannot cancel once the goods are paid for", () => {
    for (const status of ["PAID", "RECEIVED", "DISPUTED", "DELIVERY_FAILED", "RETURNED"]) {
      expect(nextStatuses(status)).not.toContain("CANCELLED");
    }
  });

  it("can be cancelled after confirmation, before any money moves", () => {
    // BU needs a way out of CONFIRMED for a human error. Forcing it through REJECTED poisoned the
    // one metric REJECTED exists to feed — it means *the supplier* killed the order.
    expect(nextStatuses("CREATED")).toContain("CANCELLED");
    expect(nextStatuses("CONFIRMED")).toContain("CANCELLED");
    expect(nextStatuses("CONFIRMED")).toContain("REJECTED");
  });

  it("flags every failure branch as note-required and no happy-path step", () => {
    for (const status of [
      "CANCELLED", "REJECTED", "RETURNED", "REFUNDED", "PAYMENT_FAILED",
      "DELIVERY_FAILED", "DISPUTED", "WRITTEN_OFF",
    ]) {
      expect(requiresNote(status)).toBe(true);
    }

    expect(requiresNote("CONFIRMED")).toBe(false);
    expect(requiresNote("PAID")).toBe(false);
    expect(requiresNote("STOCKED")).toBe(false);
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

  // `terminal` and the transition map are two separately-maintained facts about the same thing,
  // and changing a status's terminality is a two-place edit. This is the check that makes a
  // half-done one fail at the source: when RETURNED gained onward moves, the only thing that
  // noticed was a totals helper three layers downstream that had quietly been using `terminal`
  // as a proxy for "this order is dead".
  it.each(WHOLE_BUY_STATUSES)(
    "$value: the terminal flag agrees with the transition map",
    ({ value, terminal }) => {
      expect(WHOLE_BUY_TRANSITIONS[value].length === 0).toBe(terminal);
    },
  );

  // The totals rule is about physical outcome — did the gold reach the vault — and must never be
  // re-derived from `terminal`, which only describes the shape of the machine. Every excluded
  // status has to be a real status, and no status still on the happy path may be excluded.
  it.each(WHOLE_BUY_EXCLUDED_FROM_TOTALS)("%s is a real status excluded from totals", (value) => {
    expect(WHOLE_BUY_STATUSES.map((s) => s.value)).toContain(value);
    expect(countsTowardTotal(value)).toBe(false);
    expect(statusMeta(value)?.kind).toBe("bad");
  });
});

describe("list totals", () => {
  it("excludes orders that put no gold in the vault", () => {
    expect(countsTowardTotal("CANCELLED")).toBe(false);
    expect(countsTowardTotal("REJECTED")).toBe(false);
    expect(countsTowardTotal("RETURNED")).toBe(false);
    expect(countsTowardTotal("REFUNDED")).toBe(false);
  });

  it("still excludes RETURNED now that it is not terminal", () => {
    // the guard against reviving the old `bad && terminal` shorthand: RETURNED gained onward
    // moves, and inferring "counts toward stock" from "can still move" would start summing gold
    // that went straight back to the supplier
    expect(isTerminal("RETURNED")).toBe(false);
    expect(countsTowardTotal("RETURNED")).toBe(false);
  });

  it("counts everything still in flight, plus stocked", () => {
    for (const status of ["CREATED", "CONFIRMED", "PAID", "RECEIVED", "STOCKED"]) {
      expect(countsTowardTotal(status)).toBe(true);
    }
  });

  it("counts the recoverable failures — they can still complete", () => {
    expect(countsTowardTotal("PAYMENT_FAILED")).toBe(true);
    expect(countsTowardTotal("DISPUTED")).toBe(true);
    // a late shipment is late, not dead
    expect(countsTowardTotal("DELIVERY_FAILED")).toBe(true);
  });

  it("drops a written-off order — our money went out but no gold ever came in", () => {
    // these columns are gold-centric, so this reads inverted from the sell side, where
    // WRITTEN_OFF means the gold left for good and therefore keeps counting
    expect(countsTowardTotal("WRITTEN_OFF")).toBe(false);
  });

  it("excludes an unknown status rather than guessing", () => {
    expect(countsTowardTotal("NOT_A_STATUS")).toBe(false);
  });
});

describe("weight rendering", () => {
  it("renders whole numbers without padding", () => {
    // a 2 kg order is "2", not "2.000" — the operator typed 2
    expect(formatWeight(2)).toBe("2");
    expect(formatWeight(12)).toBe("12");
  });

  it("keeps the decimals that are really there", () => {
    expect(formatWeight(11.95)).toBe("11.95");
    expect(formatWeight(0.5)).toBe("0.5");
  });

  it("strips floating-point residue from summed weights", () => {
    expect(formatWeight(0.1 + 0.2)).toBe("0.3");
    expect(formatWeight(11.95 + 12)).toBe("23.95");
  });

  it("handles zero and negatives (variance figures)", () => {
    expect(formatWeight(0)).toBe("0");
    expect(formatWeight(-0.05)).toBe("-0.05");
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
