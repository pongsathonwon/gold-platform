import { describe, expect, it } from "vitest";
import { happyNextStatus } from "./happyPath";

const STATUSES = [
  { value: "A", kind: "happy" },
  { value: "B", kind: "happy" },
  { value: "C", kind: "happy" },
  { value: "BAD", kind: "bad" },
  { value: "DEAD", kind: "bad" },
] as const;

type S = (typeof STATUSES)[number]["value"];

const TRANSITIONS: Record<S, S[]> = {
  // the failure branch listed first, to prove the choice is by kind and not by position
  A: ["BAD", "B"],
  B: ["C", "BAD"],
  C: [],
  BAD: ["B", "DEAD"],
  DEAD: [],
};

describe("happyNextStatus", () => {
  it("picks the first happy move, wherever the map lists it", () => {
    expect(happyNextStatus(STATUSES, TRANSITIONS, "A")).toBe("B");
    expect(happyNextStatus(STATUSES, TRANSITIONS, "B")).toBe("C");
  });

  it("offers nothing from a terminal status", () => {
    expect(happyNextStatus(STATUSES, TRANSITIONS, "C")).toBeNull();
  });

  it("offers nothing from a failure branch, even one with a happy exit", () => {
    // BAD can go back to B, but deciding that is a judgement call for the detail page
    expect(happyNextStatus(STATUSES, TRANSITIONS, "BAD")).toBeNull();
    expect(happyNextStatus(STATUSES, TRANSITIONS, "DEAD")).toBeNull();
  });

  it("offers nothing for a status it does not recognise", () => {
    expect(happyNextStatus(STATUSES, TRANSITIONS, "NOPE")).toBeNull();
  });
});
