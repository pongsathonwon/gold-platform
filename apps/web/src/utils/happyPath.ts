/**
 * The one move a row on the happy path makes next.
 *
 * Every list offers a quick advance beside each row: one button, one step forward. The step comes
 * from the same transition map the API validates against, so it can never offer a move the server
 * would refuse, and it is chosen by one rule rather than a hand-written table per domain:
 *
 *  - only a row whose *current* status is on the happy path gets one. A failure branch —
 *    `PAYMENT_FAILED`, `DISPUTED`, `RETURNED` — is a judgement call with a reason to record, and
 *    that is worked from the detail page, where every exit is offered with its note field.
 *  - of the moves the map allows, the first `happy` one is the next step. The maps list the
 *    forward move first on every happy-path status, so "first" and "forward" agree; a test pins
 *    the walk on each domain in case a map is ever reordered.
 *
 * `null` means no quick step: terminal, in a failure branch, or unknown.
 */
export function happyNextStatus<S extends string>(
  statuses: readonly { value: S; kind: string }[],
  transitions: Record<S, readonly S[]>,
  current: string,
): S | null {
  const meta = statuses.find((s) => s.value === current);
  if (!meta || meta.kind !== "happy") return null;
  const happy = new Set(statuses.filter((s) => s.kind === "happy").map((s) => s.value));
  return transitions[meta.value].find((s) => happy.has(s)) ?? null;
}
