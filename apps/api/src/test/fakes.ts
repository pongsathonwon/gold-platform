import { Cause, Effect } from "effect";
import { randomUUID } from "crypto";
import type {
    CreateWholeBuyStatus, WholeBuyStatus, WholeBuyTransactionShape,
} from "../infrastructure/db/schema/wholesale-buy.schema.js";
import type {
    CreateWholeSellStatus, WholeSellStatus, WholeSellTransactionShape,
} from "../infrastructure/db/schema/wholesale-sell.schema.js";
import type {
    CreateRetailBuyStatus, RetailBuyStatus, RetailBuyTransactionShape,
} from "../infrastructure/db/schema/retail-buy.schema.js";
import type {
    CreateRetailSellStatus, RetailSellStatus, RetailSellTransactionShape,
} from "../infrastructure/db/schema/retail-sell.schema.js";
import { TransactionNotFoundError as BuyNotFound } from "../core/wholesale-buy/port/wholesale-buy.port.js";
import { TransactionNotFoundError as SellNotFound } from "../core/wholesale-sell/port/wholesale-sell.port.js";
import { TransactionNotFoundError as RetailBuyNotFound } from "../core/retail-buy/port/retail-buy.port.js";
import { TransactionNotFoundError as RetailSellNotFound } from "../core/retail-sell/port/retail-sell.port.js";

/**
 * In-memory stand-ins for the two wholesale repositories.
 *
 * They hold one transaction and its status log, which is all a transition test needs: every
 * usecase under test loads a transaction by id, writes status rows, and patches a couple of
 * columns. Keeping the whole log lets the tests assert on *how many* rows a call wrote, which is
 * the property `/receive-stock` rests on.
 */

const baseFields = {
    supplierId: randomUUID(),
    purityId: "965",
    productTypeId: "BAR",
    // a 12 gold-baht order at 48,250/GB
    weightGb: 12,
    weightGm: 182.4,
    conversionFactor: 15.2,
    pricePerGb965: 48250,
    pricePerGb999: 49950,
    totalAmount: 579000,
    actualWeightGb: null,
    actualWeightGm: null,
    actualAmount: null,
    settledAmount: null,
    returnReason: null,
    // The day the deal happened, the period it therefore falls in, and the instant it was
    // written — all consistent, which is the ordinary same-day case. Friday 12 June opens
    // 2026-W24. A test about backdating overrides transactionDate alone.
    transactionDate: "2026-06-12",
    settlementPeriod: "2026-W24",
    confirmDueAt: new Date("2026-06-13T00:00:00Z"),
    notes: null,
    recordedBy: "tester",
    recordedAt: new Date("2026-06-12T09:00:00Z"),
}

export function buyTransaction(
    overrides: Partial<WholeBuyTransactionShape> = {},
): WholeBuyTransactionShape {
    return { id: randomUUID(), ...baseFields, currentStatus: "CREATED", ...overrides }
}

export function sellTransaction(
    overrides: Partial<WholeSellTransactionShape> = {},
): WholeSellTransactionShape {
    return { id: randomUUID(), ...baseFields, currentStatus: "CREATED", ...overrides }
}

export interface FakeBuyRepo {
    transaction: WholeBuyTransactionShape
    statuses: CreateWholeBuyStatus[]
    repo: Record<string, (...args: never[]) => unknown>
}

/** The repository the buy usecase talks to, backed by a single mutable transaction. */
export function makeFakeBuyRepo(transaction: WholeBuyTransactionShape) {
    const state = { transaction, statuses: [] as CreateWholeBuyStatus[] }

    const repo = {
        createTransaction: (req: WholeBuyTransactionShape) => {
            state.transaction = req
            return Effect.succeed(req)
        },
        findTransactionById: (id: string) =>
            id === state.transaction.id
                ? Effect.succeed(state.transaction)
                : Effect.fail(new BuyNotFound({ id })),
        listTransactions: () => Effect.succeed([state.transaction]),
        updateTransaction: (_id: string, fields: Partial<WholeBuyTransactionShape>) => {
            state.transaction = { ...state.transaction, ...fields }
            return Effect.succeed(state.transaction)
        },
        updateCurrentStatus: (_id: string, status: WholeBuyStatus) => {
            state.transaction = { ...state.transaction, currentStatus: status }
            return Effect.void
        },
        recordContestedWeights: (_id: string, fields: Partial<WholeBuyTransactionShape>) => {
            state.transaction = { ...state.transaction, ...fields }
            return Effect.void
        },
        recordSettlement: (_id: string, fields: Partial<WholeBuyTransactionShape>) => {
            state.transaction = { ...state.transaction, ...fields }
            return Effect.void
        },
        listCreated: () =>
            Effect.succeed(state.transaction.currentStatus === "CREATED" ? [state.transaction] : []),
        createStatus: (req: CreateWholeBuyStatus) => {
            state.statuses.push(req)
            return Effect.void
        },
        listStatuses: () => Effect.succeed([]),
    }

    return { state, repo }
}

/** The same, for wholesale-sell. */
export function makeFakeSellRepo(transaction: WholeSellTransactionShape) {
    const state = { transaction, statuses: [] as CreateWholeSellStatus[] }

    const repo = {
        createTransaction: (req: WholeSellTransactionShape) => {
            state.transaction = req
            return Effect.succeed(req)
        },
        findTransactionById: (id: string) =>
            id === state.transaction.id
                ? Effect.succeed(state.transaction)
                : Effect.fail(new SellNotFound({ id })),
        listTransactions: () => Effect.succeed([state.transaction]),
        updateTransaction: (_id: string, fields: Partial<WholeSellTransactionShape>) => {
            state.transaction = { ...state.transaction, ...fields }
            return Effect.succeed(state.transaction)
        },
        updateCurrentStatus: (_id: string, status: WholeSellStatus) => {
            state.transaction = { ...state.transaction, currentStatus: status }
            return Effect.void
        },
        recordContestedWeights: (_id: string, fields: Partial<WholeSellTransactionShape>) => {
            state.transaction = { ...state.transaction, ...fields }
            return Effect.void
        },
        recordSettlement: (_id: string, fields: Partial<WholeSellTransactionShape>) => {
            state.transaction = { ...state.transaction, ...fields }
            return Effect.void
        },
        listCreated: () =>
            Effect.succeed(state.transaction.currentStatus === "CREATED" ? [state.transaction] : []),
        createStatus: (req: CreateWholeSellStatus) => {
            state.statuses.push(req)
            return Effect.void
        },
        listStatuses: () => Effect.succeed([]),
    }

    return { state, repo }
}

/**
 * The retail pair. Far smaller than their wholesale counterparts, and the missing methods are the
 * point: retail has no update, no contested weight, no settlement and no bulk-confirm sweep, so a
 * test that reached for one would not compile.
 */

const retailBaseFields = {
    branchCode: "HQ",
    purityId: "965",
    productTypeId: "BAR",
    brandId: null,
    // 5 gold baht at 49,000/GB — a counter-sized trade, unlike wholesale's 12 GB order
    weightGb: 5,
    weightGm: 76,
    conversionFactor: 15.2,
    pricePerGb: 49000,
    totalAmount: 245000,
    operationFee: null,
    // Same consistent same-day case as the wholesale fixture: Friday 12 June opens 2026-W24.
    transactionDate: "2026-06-12",
    settlementPeriod: "2026-W24",
    source: "MANUAL",
    notes: null,
    recordedBy: "tester",
    recordedAt: new Date("2026-06-12T09:00:00Z"),
}

export function retailBuyTransaction(
    overrides: Partial<RetailBuyTransactionShape> = {},
): RetailBuyTransactionShape {
    return { id: randomUUID(), ...retailBaseFields, currentStatus: "CONFIRMED", ...overrides }
}

export function retailSellTransaction(
    overrides: Partial<RetailSellTransactionShape> = {},
): RetailSellTransactionShape {
    return { id: randomUUID(), ...retailBaseFields, currentStatus: "CONFIRMED", ...overrides }
}

export function makeFakeRetailBuyRepo(transaction: RetailBuyTransactionShape) {
    const state = { transaction, statuses: [] as CreateRetailBuyStatus[] }

    const repo = {
        createTransaction: (req: RetailBuyTransactionShape) => {
            state.transaction = req
            return Effect.succeed(req)
        },
        findTransactionById: (id: string) =>
            id === state.transaction.id
                ? Effect.succeed(state.transaction)
                : Effect.fail(new RetailBuyNotFound({ id })),
        listTransactions: () => Effect.succeed([state.transaction]),
        updateCurrentStatus: (_id: string, status: RetailBuyStatus) => {
            state.transaction = { ...state.transaction, currentStatus: status }
            return Effect.void
        },
        createStatus: (req: CreateRetailBuyStatus) => {
            state.statuses.push(req)
            return Effect.void
        },
        listStatuses: () => Effect.succeed([]),
    }

    return { state, repo }
}

/** The same, for retail-sell. */
export function makeFakeRetailSellRepo(transaction: RetailSellTransactionShape) {
    const state = { transaction, statuses: [] as CreateRetailSellStatus[] }

    const repo = {
        createTransaction: (req: RetailSellTransactionShape) => {
            state.transaction = req
            return Effect.succeed(req)
        },
        findTransactionById: (id: string) =>
            id === state.transaction.id
                ? Effect.succeed(state.transaction)
                : Effect.fail(new RetailSellNotFound({ id })),
        listTransactions: () => Effect.succeed([state.transaction]),
        updateCurrentStatus: (_id: string, status: RetailSellStatus) => {
            state.transaction = { ...state.transaction, currentStatus: status }
            return Effect.void
        },
        createStatus: (req: CreateRetailSellStatus) => {
            state.statuses.push(req)
            return Effect.void
        },
        listStatuses: () => Effect.succeed([]),
    }

    return { state, repo }
}

/** The status values a call appended to the log, oldest first. */
export const loggedStatuses = (statuses: { status: string }[]) => statuses.map((s) => s.status)

/**
 * Runs a usecase Effect and returns its failure, asserting that it did fail.
 *
 * `R` is left open and erased at the run boundary. Statically these usecases still require
 * `DrizzleClient` — `resolveMeasuredQuantity` reaches for it — but the suite mocks that module
 * away, which the type checker cannot see. The cast is the one place that gap is acknowledged;
 * if a mock is ever missing, the effect dies at run time and `Cause.pretty` below names it.
 */
export async function expectFailure<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<E> {
    const exit = await Effect.runPromiseExit(effect as Effect.Effect<A, E, never>)
    if (exit._tag === "Success") {
        throw new Error(`expected the effect to fail, but it succeeded with ${JSON.stringify(exit.value)}`)
    }
    const failure = exit.cause._tag === "Fail" ? exit.cause.error : undefined
    // a Die here means a defect, not a domain error — surface it, because a swallowed one looks
    // exactly like a passing "it failed as expected" assertion
    if (failure === undefined) {
        throw new Error(`expected a typed failure, got ${exit.cause._tag}: ${Cause.pretty(exit.cause)}`)
    }
    return failure
}

/** Runs a usecase Effect and returns its value, asserting that it succeeded. See above on `R`. */
export async function expectSuccess<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect as Effect.Effect<A, E, never>)
    if (exit._tag === "Failure") {
        throw new Error(`expected the effect to succeed, but it failed: ${Cause.pretty(exit.cause)}`)
    }
    return exit.value
}
