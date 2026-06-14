import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateRetailBuyStatus, CreateRetailBuyTransaction,
    RetailBuyStatus, RetailBuyTransactionShape,
    retailBuyStatuses, retailBuyTransactions,
} from "../../../infrastructure/db/schema/retail-buy.schema.js";
import { ForRetailBuyRepository, TransactionNotFoundError } from "../port/retail-buy.port.js";

class RetailBuyRepositoryImpl implements ForRetailBuyRepository {
    constructor(private readonly db: Database) {}

    createTransaction(req: CreateRetailBuyTransaction) {
        return Effect.tryPromise({
            try: () => this.db.insert(retailBuyTransactions).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create retail buy transaction" }),
        }).pipe(Effect.map((res) => res[0]));
    }

    findTransactionById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(retailBuyTransactions).where(eq(retailBuyTransactions.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find retail buy transaction: ${id}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length === 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new TransactionNotFoundError({ id }))
            )
        );
    }

    listTransactions(req: Partial<Pick<RetailBuyTransactionShape, 'currentStatus' | 'settlementPeriod' | 'branchCode'>>) {
        const conditions = [
            req.currentStatus ? eq(retailBuyTransactions.currentStatus, req.currentStatus) : undefined,
            req.settlementPeriod ? eq(retailBuyTransactions.settlementPeriod, req.settlementPeriod) : undefined,
            req.branchCode ? eq(retailBuyTransactions.branchCode, req.branchCode) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select().from(retailBuyTransactions)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list retail buy transactions" }),
        });
    }

    updateCurrentStatus(id: string, status: RetailBuyStatus) {
        return Effect.tryPromise({
            try: () => this.db.update(retailBuyTransactions)
                .set({ currentStatus: status })
                .where(eq(retailBuyTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update status for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    createStatus(req: CreateRetailBuyStatus) {
        return Effect.tryPromise({
            try: () => this.db.insert(retailBuyStatuses).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create retail buy status" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listStatuses(transactionId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(retailBuyStatuses)
                .where(eq(retailBuyStatuses.transactionId, transactionId))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot list statuses for transaction: ${transactionId}` }),
        });
    }
}

export const makeRetailBuyRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new RetailBuyRepositoryImpl(db);
});
