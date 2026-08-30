/**
 * The nightly confirm sweep — closes the day's edit window on both wholesale domains.
 *
 * `PATCH /wholesale-{buy,sell}/:id` is accepted while a transaction is `CREATED` and refused after,
 * so confirmation *is* the lock. This run is the cutoff: there is no per-transaction deadline, and
 * `confirmDueAt` on a transaction is only a display of when this job next lands.
 *
 * Run as a Cloud Run job on a schedule, not as an HTTP call to the `confirm-all` routes. Those
 * exist for the operator's mid-day manual run and are `requireRole('ADMIN')`, so a
 * caller needs an HS256 token the app itself minted — and those last an hour. Giving a scheduler a
 * standing credential to an endpoint that can end the edit window for every open transaction is a
 * worse trade than running the usecase directly, which needs no credential at all. It is the same
 * shape as migrate.js and seed.js: a job, the database, and no HTTP surface.
 *
 * It runs on `jobRuntime`, which is built from the database layer alone, so this process never
 * reads JWT_SECRET or CORS_ORIGIN. Both used to be bound to the Cloud Run job purely to get past
 * a config parser that insisted on the whole environment. `runJob` types that guarantee: an
 * effect needing JwtConfig will not compile here.
 *
 * Both domains run even if the first fails, because they are independent books and half a sweep is
 * better than none — but any failure exits non-zero so the schedule reports it rather than logging
 * quietly into an empty room.
 *
 * Idempotent: once a transaction leaves CREATED it stops matching `listCreated()`, so a retry or a
 * double-fire confirms nothing twice. Passing no actor logs the moves as `BOT-CONFIRM`, which is
 * what distinguishes them in the status log from an operator's manual run.
 *
 * Usage: node dist/scripts/confirm-sweep.js
 */
import { confirmAllCreated as confirmBuys } from "../core/wholesale-buy/application/wholesale-buy.usecase.js";
import { confirmAllCreated as confirmSells } from "../core/wholesale-sell/application/wholesale-sell.usecase.js";
import { jobRuntime, runJob } from "../infrastructure/runtime.js";

const sweeps = [
    { domain: "wholesale-buy", run: confirmBuys },
    { domain: "wholesale-sell", run: confirmSells },
] as const;

let failed = false;

for (const sweep of sweeps) {
    // No actor: the status rows are written as BOT-CONFIRM.
    const outcome = await runJob(sweep.run());
    if (outcome.result === "success") {
        console.log(`${sweep.domain}: confirmed ${outcome.data.confirmed}`);
    } else {
        failed = true;
        console.error(`${sweep.domain}: FAILED —`, outcome.error);
    }
}

await jobRuntime.dispose();

if (failed) {
    console.error("Confirm sweep finished with failures.");
    process.exitCode = 1;
} else {
    console.log("Confirm sweep complete.");
}
