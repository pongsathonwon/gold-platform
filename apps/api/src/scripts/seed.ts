/**
 * Sprint 1 seed — run once on a fresh database after migration.
 * Usage: tsx --env-file=.env src/scripts/seed.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { casing: "snake_case" });

// lazy imports so schema types resolve after casing is set
const { brands, purities, productTypes, unitConversions, productTypePurities, suppliers, supplierBrands } = await import(
    "../infrastructure/db/schema/master.schema.js"
);
const { users } = await import("../infrastructure/db/schema/user.schema.js");

const MIN_SEED_PASSWORD_LENGTH = 12;

interface SeedUserReq {
    role: "ADMIN" | "OPERATOR";
    name: string;
    username: string;
    password: string | undefined;
    /** the environment variable the password came from, so a refusal names what to set */
    passwordVar: string;
    /** when false the account is skipped if no password was supplied, rather than failing */
    required: boolean;
}

/**
 * Creates one seeded login, or explains why it did not.
 *
 * `onConflictDoNothing` means re-running the seed never changes an existing account — in
 * particular it will not reset a password that has since been changed.
 */
async function seedUser(req: SeedUserReq) {
    if (!req.password) {
        if (req.required) {
            throw new Error(
                `${req.passwordVar} is not set. Set it to a generated value before seeding — ` +
                `this account can adjust inventory and create users.`,
            );
        }
        console.log(`  – ${req.role.toLowerCase()} user skipped (${req.passwordVar} not set)`);
        return;
    }
    if (req.password.length < MIN_SEED_PASSWORD_LENGTH) {
        throw new Error(`${req.passwordVar} must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`);
    }

    const passwordHash = await bcrypt.hash(req.password, 10);
    await db
        .insert(users)
        .values({ name: req.name, username: req.username, passwordHash, role: req.role })
        .onConflictDoNothing();
    console.log(`  ✓ ${req.role.toLowerCase()} user (username: ${req.username}, role: ${req.role})`);
}

async function seed() {
    console.log("Seeding Sprint 1 data...");

    // --- Purities ---
    await db
        .insert(purities)
        .values([
            { id: "999", label: "99.9%", percent: 99.9, unitOfMeasure: 'g', active: true },
            { id: "965", label: "96.5%", percent: 96.5, unitOfMeasure: "gb", active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ purities");

    // --- Product types ---
    await db
        .insert(productTypes)
        .values([
            { id: "BAR", productType: "ทองแท่ง", supplierTradeable: true, active: true },
            { id: "PLATE", productType: "ทองแผ่น", supplierTradeable: true, active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ product types");

    // --- Brands ---
    // 'NA' is the sentinel brandId for 99.9% goldbar pools (active=false keeps it off dropdowns)
    await db
        .insert(brands)
        .values([
            { id: "NA", brand: "อื่นๆ", nonFungible: false, active: true },
            { id: "HUA_GOLD", brand: "ฮั่วเซ่งเฮง", nonFungible: true, active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ brands (including NA sentinel)");

    // --- Unit conversion (baht → gram for 96.5%) ---
    // 1 baht = 15.16 grams (standard Thai gold weight)
    await db
        .insert(unitConversions)
        .values([{ factorValue: 15.244, effectiveDate: "2024-01-01", changeBy: null }])
        .onConflictDoNothing();
    console.log("  ✓ unit conversion (1 baht = 15.244 g)");

    // --- Product type × purity rules (valid combinations + weight input unit) ---
    await db
        .insert(productTypePurities)
        .values([
            { productTypeId: "BAR", purityId: "999", inputUnit: "kg", minQuantity: 1, allowedValues: [1, 2, 3, 4, 5], stepQuantity: null, active: true },
            // 96.5% gold bar steps by 5: bars are 5/10/20/50 GB, so every real quantity is a sum
            // of those. Valid weights are 5, 10, 15, 20, …
            { productTypeId: "BAR", purityId: "965", inputUnit: "gb", minQuantity: 5, allowedValues: null, stepQuantity: 5, active: true },
            // ทองแผ่น is a sub-5-GB product by definition, so it takes no step — a step of 5 would
            // leave it with no enterable weight below its own maximum
            { productTypeId: "PLATE", purityId: "965", inputUnit: "gb", minQuantity: 1, allowedValues: null, stepQuantity: null, active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ product type × purity rules");

    // --- Suppliers ---
    // wholesale-buy cannot record anything without one. IDs are fixed rather than defaultRandom
    // so re-running the seed updates nothing instead of piling up duplicates.
    await db
        .insert(suppliers)
        .values([
            { id: "11111111-1111-4111-8111-111111111111", supplierName: "ฮั่วเซ่งเฮง", brandLock: true, active: true },
            { id: "22222222-2222-4222-8222-222222222222", supplierName: "ออโรร่า", brandLock: false, active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ suppliers");

    // --- Supplier brands ---
    // Which stamps each supplier can ship. This is what the brand-split UI reads, and it is the
    // whole reason the HUA rule is data rather than code:
    //   ฮั่วเซ่งเฮง is brandLock, so its one registered brand takes 100% and nothing is enterable
    //   ออโรร่า is not, so HUA_GOLD becomes an enterable line and the rest falls to NA
    // Registering a second stamped brand later is another row here, not a code change. BU tracks
    // only these two today because identifying every stamp on the floor is not work they can do.
    await db
        .insert(supplierBrands)
        .values([
            { supplierId: "11111111-1111-4111-8111-111111111111", brandId: "HUA_GOLD" },
            { supplierId: "22222222-2222-4222-8222-222222222222", brandId: "HUA_GOLD" },
        ])
        .onConflictDoNothing();
    console.log("  ✓ supplier brands");

    // --- Users ---
    //
    // Neither password has a default. `SEED_PASSWORD` used to fall back to "admin", which meant an
    // unset environment variable produced a production administrator with a five-character
    // password — on a system where that account can write off stock and issue further logins.
    // Someone who has to supply a password cannot forget to.
    await seedUser({
        role: "ADMIN",
        name: "Admin",
        username: process.env.SEED_USERNAME ?? "admin",
        password: process.env.SEED_PASSWORD,
        passwordVar: "SEED_PASSWORD",
        required: true,
    });

    /**
     * A second login for trying the app as an ordinary operator — the role that runs the trading
     * day but cannot adjust stock or confirm the book.
     *
     * Optional on purpose. It is created only when `SEED_OPERATOR_PASSWORD` is set, so a local or
     * demo environment gets both roles from one command while a production seed does not quietly
     * gain a shared operator account nobody is named on. Real staff logins are issued individually
     * through `POST /auth/users`.
     */
    await seedUser({
        role: "OPERATOR",
        name: "Operator",
        username: process.env.SEED_OPERATOR_USERNAME ?? "operator",
        password: process.env.SEED_OPERATOR_PASSWORD,
        passwordVar: "SEED_OPERATOR_PASSWORD",
        required: false,
    });

    console.log("\nDone. You can now run POST /auth/login with the seeded credentials.");
}

await seed().finally(() => client.end());
