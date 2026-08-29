/**
 * Sprint 1 seed — run once on a fresh database after migration.
 * Usage: tsx --env-file=.env src/scripts/seed.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";
import { socketOptions } from "../infrastructure/db/connection.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

// socketOptions supplies the Cloud SQL unix socket; postgres.js will not take it from the URL.
const client = postgres(DATABASE_URL, socketOptions(DATABASE_URL));
const db = drizzle(client, { casing: "snake_case" });

// lazy imports so schema types resolve after casing is set
const { brands, branches, purities, productTypes, unitConversions, productTypePurities, suppliers, supplierBrands } = await import(
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

    // --- Branches ---
    //
    // Both retail tables carry a required FK to this table, and it had never held a row — so until
    // now no retail transaction could be inserted at all, whatever the request body said.
    //
    // Sourced from the shop's branch export of 2026-08-24. Two things about that data are worth
    // knowing before reading a row:
    //
    //   `branchCode` is the legacy numeric id and is NOT the G-number. Branch 1 is G006 and branch
    //   6 is G001; the two sequences diverged long ago. The numeric id is the primary key and is
    //   what lands on every transaction, so it is what has to be right — the G-number is display.
    //
    //   The export also carries an opening date. It is not stored: it is empty for the thirteen
    //   oldest branches and nothing reads it.
    //
    // Every row came across active; `deletedAt` is left null throughout and is how a branch is
    // retired later, since a hard delete is impossible once transactions reference it.
    await db
        .insert(branches)
        .values([
            { branchCode: "0", branchName: "G000-สำนักงานใหญ่", branchShortName: "G000", active: true },
            { branchCode: "1", branchName: "G006-TLBP บางพลี", branchShortName: "G006", active: true },
            { branchCode: "3", branchName: "G003-TLLP ลาดพร้าว", branchShortName: "G003", active: true },
            { branchCode: "6", branchName: "G001-BCRD รัชดา", branchShortName: "G001", active: true },
            { branchCode: "7", branchName: "G007-IMSR สำโรง", branchShortName: "G007", active: true },
            { branchCode: "8", branchName: "G008-TLKS กำแพงแสน", branchShortName: "G008", active: true },
            { branchCode: "9", branchName: "G009-TLSY ศาลายา", branchShortName: "G009", active: true },
            { branchCode: "10", branchName: "G010-MVPN พัฒนาการ", branchShortName: "G010", active: true },
            { branchCode: "14", branchName: "G014-BCTN ติวานนท์", branchShortName: "G014", active: true },
            { branchCode: "15", branchName: "G015-PSRY ระยอง", branchShortName: "G015", active: true },
            { branchCode: "16", branchName: "G016-APAY อยุธยา", branchShortName: "G016", active: true },
            { branchCode: "17", branchName: "G017-ODSN ศรีนครินทร์", branchShortName: "G017", active: true },
            { branchCode: "19", branchName: "G019-WisDom Gems", branchShortName: "G019", active: true },
            { branchCode: "20", branchName: "G020-JSBW บ่อวิน", branchShortName: "G020", active: true },
            { branchCode: "21", branchName: "G021-BCLB ลพบุรี", branchShortName: "G021", active: true },
            { branchCode: "23", branchName: "G023-HMLC แหลมฉบัง", branchShortName: "G023", active: true },
            { branchCode: "24", branchName: "G024-TCPT พัทยาใต้", branchShortName: "G024", active: true },
            { branchCode: "26", branchName: "G026-TLBB บ้านบึง", branchShortName: "G026", active: true },
            { branchCode: "27", branchName: "G027-TLLS หลังสวน", branchShortName: "G027", active: true },
            { branchCode: "28", branchName: "G028-RKAR โรงเกลือ อรัญฯ", branchShortName: "G028", active: true },
            { branchCode: "29", branchName: "G029-GM04 LTBS บางแสน", branchShortName: "G029-GM04", active: true },
            { branchCode: "30", branchName: "G030-Online G99", branchShortName: "G030", active: true },
            { branchCode: "31", branchName: "G031-TSKS กำแพงแสน", branchShortName: "G031", active: true },
            { branchCode: "32", branchName: "G032-WTMS แม่สาย", branchShortName: "G032", active: true },
            { branchCode: "33", branchName: "G033-UTR สนญ.", branchShortName: "G033", active: true },
            { branchCode: "35", branchName: "G035-MBK มาบุญครอง", branchShortName: "G035", active: true },
            { branchCode: "36", branchName: "G036-TPNR ฐานเพชร", branchShortName: "G036", active: true },
            { branchCode: "37", branchName: "G037-STMK มหาสารคาม", branchShortName: "G037", active: true },
            { branchCode: "38", branchName: "G038-TSNR นนทบุรี", branchShortName: "G038", active: true },
            { branchCode: "39", branchName: "G039-LMCR ล้านเมือง เชียงราย", branchShortName: "G039", active: true },
            { branchCode: "40", branchName: "G040-ASNK อัศวรรณ หนองคาย", branchShortName: "G040", active: true },
            { branchCode: "41", branchName: "G041-BYNR ตลาดบางใหญ่ นนทบุรี", branchShortName: "G041", active: true },
            { branchCode: "42", branchName: "G042-TYAY ตลาดธันยา อ้อมใหญ่", branchShortName: "G042", active: true },
            { branchCode: "43", branchName: "G043-CHBD ตลาดซี.เอช.บางกระดี่", branchShortName: "G043", active: true },
            { branchCode: "44", branchName: "G044-CWPT ตลาดชัชวาล ปทุมธานี", branchShortName: "G044", active: true },
            { branchCode: "45", branchName: "G045-MKPY แม็คโคร พญาไท", branchShortName: "G045", active: true },
            { branchCode: "46", branchName: "G046-GPR9 โกลด์เด้น เพลช พระรามเก้า", branchShortName: "G046", active: true },
            { branchCode: "47", branchName: "G047-MKJH แม็คโคร จอหอ นครราชสีมา", branchShortName: "G047", active: true },
            { branchCode: "48", branchName: "G048-MKBP แม็คโครบ้านไผ่", branchShortName: "G048", active: true },
            { branchCode: "49", branchName: "G049-GM01 CJBC บางโฉลง", branchShortName: "G049-GM01", active: true },
            { branchCode: "50", branchName: "G050-GM02 NBR2 ราม2", branchShortName: "G050-GM02", active: true },
            { branchCode: "51", branchName: "G051-GM03 SNBK เสนีย์ฟู้ดส์ บางแค", branchShortName: "G051-GM03", active: true },
            { branchCode: "52", branchName: "G052-PMSR ปิงมาร์เช่ สำโรง", branchShortName: "G052", active: true },
            { branchCode: "53", branchName: "G053-GM05 TYAY ตลาดธันยา นครปฐม", branchShortName: "G053-GM05", active: true },
            { branchCode: "54", branchName: "G054-PMUS ปิงมาร์เช่ อุดมสุข", branchShortName: "G054", active: true },
            { branchCode: "55", branchName: "G055-GM06 TNCB ตึกน้ำชลบุรี", branchShortName: "G55-GM06", active: true },
            { branchCode: "99", branchName: "G099-ทดสอบ", branchShortName: "G099", active: true },
        ])
        .onConflictDoNothing();
    console.log("  ✓ branches (47)");

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
