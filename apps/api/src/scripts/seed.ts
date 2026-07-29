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
const { brands, purities, productTypes, unitConversions, productTypePurities } = await import(
    "../infrastructure/db/schema/master.schema.js"
);
const { users } = await import("../infrastructure/db/schema/user.schema.js");

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
            { id: "BAR", productType: "Goldbar", supplierTradeable: true, active: true },
            { id: "PLATE", productType: "Gold Plate", supplierTradeable: true, active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ product types");

    // --- Brands ---
    // 'NA' is the sentinel brandId for 99.9% goldbar pools (active=false keeps it off dropdowns)
    await db
        .insert(brands)
        .values([
            { id: "NA", brand: "N/A", nonFungible: false, active: false },
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
            { productTypeId: "BAR", purityId: "999", inputUnit: "kg", minQuantity: 1, allowedValues: [1, 2, 3, 4, 5], active: true },
            { productTypeId: "BAR", purityId: "965", inputUnit: "gb", minQuantity: 10, allowedValues: null, active: true },
            { productTypeId: "PLATE", purityId: "965", inputUnit: "gb", minQuantity: 1, allowedValues: null, active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ product type × purity rules");

    // --- Admin user ---
    const username = process.env.SEED_USERNAME ?? "admin";
    const password = process.env.SEED_PASSWORD ?? "admin";
    const passwordHash = await bcrypt.hash(password, 10);

    await db
        .insert(users)
        .values({ name: "Admin", username, passwordHash })
        .onConflictDoNothing();
    console.log(`  ✓ admin user (username: ${username})`);

    console.log("\nDone. You can now run POST /auth/login with the admin credentials.");
}

await seed().finally(() => client.end());
