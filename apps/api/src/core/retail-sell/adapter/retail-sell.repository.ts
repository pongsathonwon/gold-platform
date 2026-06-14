import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateRetailSellStatus, CreateRetailSellTransaction,
    RetailSellStatus, RetailSellTransactionShape,
    retailSellStatuses, retailSellTransactions,
} from "../../../infrastructure/db/schema/retail-sell.schema.js";
import { ForRetailSellRepository, TransactionNotFoundError } from "../port/retail-sell.port.js";

class RetailSellRepositoryImpl implements ForRetailSellRepository {
    constructor(private readonly db: Database) {}

    createTransaction(req: CreateRetailSellTransaction) {
        return Effect.tryPromise({
            try: () => this.db.insert(retailSellTransactions).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create retail sell transaction" }),
        }).pipe(Effect.map((res) => res[0]));
    }

    findTransactionById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(retailSellTransactions).where(eq(retailSellTransactions.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find retail sell transaction: ${id}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length === 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new TransactionNotFoundError({ id }))
            )
        );
    }

    listTransactions(req: Partial<Pick<RetailSellTransactionShape, 'currentStatus' | 'settlementPeriod' | 'branchCode'>>) {
        const conditions = [
            req.currentStatus ? eq(retailSellTransactions.currentStatus, req.currentStatus) : undefined,
            req.settlementPeriod ? eq(retailSellTransactions.settlementPeriod, req.settlementPeriod) : undefined,
            req.branchCode ? eq(retailSellTransactions.branchCode, req.branchCode) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select().from(retailSellTransactions)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list retail sell transactions" }),
        });
    }

    updateCurrentStatus(id: string, status: RetailSellStatus) {
        return Effect.tryPromise({
            try: () => this.db.update(retailSellTransactions)
                .set({ currentStatus: status })
                .where(eq(retailSellTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update status for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    createStatus(req: CreateRetailSellStatus) {
        return Effect.tryPromise({
            try: () => this.db.insert(retailSellStatuses).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create retail sell status" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listStatuses(transactionId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(retailSellStatuses)
                .where(eq(retailSellStatuses.transactionId, transactionId))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot list statuses for transaction: ${transactionId}` }),
        });
    }
}

export const makeRetailSellRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new RetailSellRepositoryImpl(db);
});
