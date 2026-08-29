/**
 * Applies pending migrations, then exits.
 *
 * This exists because `drizzle-kit migrate` cannot run in a production image: `drizzle-kit` is a
 * devDependency, and a runtime image that installs dev dependencies to run one command is both
 * larger and a wider attack surface than it needs to be. `drizzle-orm`'s migrator is part of the
 * runtime dependency that is already there.
 *
 * Run it as a release step — a Cloud Run Job, or a one-off `--command` execution — *before*
 * routing traffic to the new revision, never from inside the server's own startup path. Migrating
 * on boot means N instances racing the same DDL on a scale-up.
 *
 * Usage: node dist/scripts/migrate.js
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { socketOptions } from "../infrastructure/db/connection.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

// max: 1 — migrations are a single serial conversation with the database, and the advisory lock
// Drizzle takes is held on one connection.
//
// `socketOptions` supplies the Cloud SQL unix socket, which postgres.js will not take from the URL.
// This construction is deliberately inside the try: it used to sit above it, so a malformed URL
// threw uncaught and Node printed the string — password and all — into Cloud Logging.
let client: postgres.Sql;
try {
    client = postgres(DATABASE_URL, { max: 1, ...socketOptions(DATABASE_URL) });
} catch (error) {
    console.error("Could not build a database connection from DATABASE_URL:",
        error instanceof Error ? error.message : "unknown error");
    process.exit(1);
}

try {
    console.log("Applying migrations...");
    // dist/scripts/migrate.js → apps/api/drizzle, so the image must copy `drizzle/` beside `dist/`
    const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
    await migrate(drizzle(client), { migrationsFolder });
    console.log("Migrations up to date.");
} catch (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
} finally {
    await client.end();
}
