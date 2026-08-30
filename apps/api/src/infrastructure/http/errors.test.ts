import { Data } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { unhandledError } from "./errors.js"
import { RepositoryError } from "../db/client.js"

/** The shape a domain error takes everywhere in this codebase. */
class SomethingDomainish extends Data.TaggedError("SomethingDomainish")<{
    secretish: string
}> {}

describe("the fallback a router's toHttpError ends with", () => {
    let logged: unknown[][]

    beforeEach(() => {
        logged = []
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            logged.push(args)
        })
    })
    afterEach(() => vi.restoreAllMocks())

    it("gives an infrastructure failure the same wording handleExit gives it", () => {
        // One dead database, one description of it, whichever entry point the request came through.
        const [message, status] = unhandledError(
            new RepositoryError({ message: 'duplicate key value violates unique constraint "users_username_unique"' }),
            "master/purity",
        )
        expect([message, status]).toEqual(["Database query failed", 500])
    })

    it("does not put the database's own words in the response", () => {
        // The bug this replaced: JSON.stringify on a TaggedError serialises its fields, so whatever
        // Postgres said — constraint names, column names, fragments of the statement — was handed
        // to the caller as the user-facing message.
        const detail = 'relation "whole_buy_transactions" does not exist'
        const [message] = unhandledError(new RepositoryError({ message: detail }), "wholesale-buy")
        expect(message).not.toContain(detail)
        expect(message).not.toContain("whole_buy_transactions")
    })

    it("keeps the detail, in the log where it is useful", () => {
        const error = new RepositoryError({ message: "connection terminated unexpectedly" })
        unhandledError(error, "wholesale-buy")
        expect(logged).toHaveLength(1)
        expect(logged[0]?.[0]).toBe("[wholesale-buy] RepositoryError")
        expect(logged[0]?.[1]).toBe(error)
    })

    it("refuses to describe a domain error it was never taught", () => {
        // Reaching here means a router forgot a branch. The caller gets nothing specific — an
        // unmapped error is by definition one nobody decided was safe to describe.
        const [message, status] = unhandledError(new SomethingDomainish({ secretish: "hunter2" }), "receive")
        expect([message, status]).toEqual(["Internal server error", 500])
        expect(message).not.toContain("hunter2")
        expect(logged[0]?.[0]).toBe("[receive] unmapped error")
    })

    it("handles the bare strings runEffect returns for a died or interrupted fiber", () => {
        // These carry no `_tag` at all, and stringified into a quoted string in the old code.
        const [message, status] = unhandledError("runtime died: TypeError: x is not a function", "inventory")
        expect([message, status]).toEqual(["Internal server error", 500])
    })

    it("survives the things that are not errors at all", () => {
        for (const odd of [null, undefined, 42, { _tag: 12 }, []]) {
            expect(() => unhandledError(odd, "master/brand")).not.toThrow()
            expect(unhandledError(odd, "master/brand")[1]).toBe(500)
        }
    })
})
