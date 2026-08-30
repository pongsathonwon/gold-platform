import { describe, expect, it } from "vitest"
import { clientAddress, FailureRateLimiter } from "./rate-limit.js"

const WINDOW = 15 * 60 * 1000

/** A limiter whose clock the test drives, so nothing sleeps. */
function limiter(max = 3, windowMs = WINDOW) {
    let now = 1_000_000
    const rl = new FailureRateLimiter({ max, windowMs, now: () => now })
    return { rl, advance: (ms: number) => { now += ms }, at: () => now }
}

describe("the failure budget", () => {
    it("allows attempts up to the limit and refuses the next", () => {
        const { rl } = limiter(3)
        for (let i = 0; i < 3; i++) {
            expect(rl.check("bob").allowed).toBe(true)
            rl.recordFailure("bob")
        }
        expect(rl.check("bob").allowed).toBe(false)
    })

    it("reports how long to wait, in whole seconds and never zero", () => {
        const { rl, advance } = limiter(1)
        rl.recordFailure("bob")
        advance(WINDOW - 500) // half a second left
        const decision = rl.check("bob")
        expect(decision.allowed).toBe(false)
        // Retry-After: 0 would invite an immediate retry, which is the thing being prevented.
        expect(decision.retryAfterSeconds).toBe(1)
    })

    it("reopens once the window has passed", () => {
        const { rl, advance } = limiter(2)
        rl.recordFailure("bob")
        rl.recordFailure("bob")
        expect(rl.check("bob").allowed).toBe(false)
        advance(WINDOW)
        expect(rl.check("bob").allowed).toBe(true)
    })

    it("keeps one key's failures away from another's", () => {
        // The point of keying at all: one account being attacked must not lock out the rest.
        const { rl } = limiter(1)
        rl.recordFailure("bob")
        expect(rl.check("bob").allowed).toBe(false)
        expect(rl.check("alice").allowed).toBe(true)
    })

    it("forgets a key on success, so a run of typos costs nothing", () => {
        const { rl } = limiter(3)
        rl.recordFailure("bob")
        rl.recordFailure("bob")
        rl.clear("bob")
        for (let i = 0; i < 3; i++) {
            expect(rl.check("bob").allowed).toBe(true)
            rl.recordFailure("bob")
        }
        expect(rl.check("bob").allowed).toBe(false)
    })

    it("does not let a lapsed window carry its old count forward", () => {
        const { rl, advance } = limiter(2)
        rl.recordFailure("bob")
        advance(WINDOW + 1)
        rl.recordFailure("bob") // opens a fresh window rather than incrementing the stale one
        expect(rl.check("bob").allowed).toBe(true)
    })

    it("sweeps expired windows once crowded, and keeps the live ones", () => {
        // Memory bound against key rotation. The sweep must never release a key that is still
        // serving a ban — that would hand an attacker a reset by flooding.
        let now = 0
        const rl = new FailureRateLimiter({ max: 1, windowMs: 1000, now: () => now, maxEntries: 3 })
        rl.recordFailure("old-1")
        rl.recordFailure("old-2")
        now += 2000 // both expire
        rl.recordFailure("live")
        rl.recordFailure("trigger-sweep")
        expect(rl.check("live").allowed).toBe(false)
    })
})

describe("reading the caller's address", () => {
    it("takes the last entry, which is the one Cloud Run appended", () => {
        // Anything before it is what the client claimed. Trusting the first would let an attacker
        // reset their own budget every request by rotating a spoofed value.
        expect(clientAddress("1.2.3.4, 203.0.113.9")).toBe("203.0.113.9")
    })

    it("handles a single address and stray whitespace", () => {
        expect(clientAddress("203.0.113.9")).toBe("203.0.113.9")
        expect(clientAddress("  1.2.3.4 ,  203.0.113.9  ")).toBe("203.0.113.9")
    })

    it("falls back to a constant when the header is absent or empty", () => {
        // One shared bucket is the safe direction: unattributable attempts are still counted.
        expect(clientAddress(undefined)).toBe("unknown")
        expect(clientAddress("")).toBe("unknown")
        expect(clientAddress(" , ")).toBe("unknown")
    })
})
