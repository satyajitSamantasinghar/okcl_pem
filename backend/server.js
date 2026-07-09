
const dotenv = require('dotenv');
dotenv.config();
const app = require("./src/app");
const { sequelize, EmployeeRAHistory, User } = require("./src/models");
const { DataTypes, Op } = require("sequelize");


const PORT = process.env.PORT || 5000;


// ─── DB Migrations ────────────────────────────────────────────────────────────
//  Safe, idempotent column-level migrations using queryInterface.
//  These run BEFORE sequelize.sync() on every startup.
//  Each migration checks if the change is already applied before touching the DB,
//  so it is safe to deploy and restart multiple times without side effects.
//  Add new migrations here when schema changes are needed; never use alter:true.
// ─────────────────────────────────────────────────────────────────────────────
const runMigrations = async () => {
    const qi = sequelize.getQueryInterface();
    const tableDesc = await qi.describeTable("users");

    // Migration 1: Add auth_provider column (needed for HRMS SSO integration)
    if (!tableDesc.auth_provider) {
        await qi.addColumn("users", "auth_provider", {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: "local",  // existing rows get "local" (password-based)
        });
        console.log("✅ Migration: added auth_provider column to users table");
    }

    // Migration 2: Allow password_hash to be NULL (HRMS SSO users have no local password)
    if (tableDesc.password_hash && tableDesc.password_hash.allowNull === false) {
        await qi.changeColumn("users", "password_hash", {
            type: DataTypes.STRING,
            allowNull: true,
        });
        console.log("✅ Migration: password_hash column set to nullable");
    }

    // Migration 3: Add designation column (job title from HRMS token)
    if (!tableDesc.designation) {
        await qi.addColumn("users", "designation", {
            type: DataTypes.STRING,
            allowNull: true,
        });
        console.log("✅ Migration: added designation column to users table");
    }

    // Migration 4: Add phone column (mobile number from HRMS token)
    if (!tableDesc.phone) {
        await qi.addColumn("users", "phone", {
            type: DataTypes.STRING,
            allowNull: true,
        });
        console.log("✅ Migration: added phone column to users table");
    }

    // Migration 5: Allow email to be NULL (HRMS SSO users like HRD may have no email)
    if (tableDesc.email && tableDesc.email.allowNull === false) {
        await qi.changeColumn("users", "email", {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
        });
        console.log("✅ Migration: email column set to nullable");
    }

    // ── One-time DB cleanup ────────────────────────────────────────────────────
    //  Set DB_TRUNCATE_ON_STARTUP=true in .env to wipe all user data (CASCADE).
    //  USE ONLY ONCE to fix data mismatches. Remove the env var after restart.
    //  CASCADE will clear users + all dependent tables (plans, evaluations, etc.)
    if (process.env.DB_TRUNCATE_ON_STARTUP === "true") {
        await sequelize.query("TRUNCATE TABLE users CASCADE");
        console.log("⚠️  DB Cleanup: all user data wiped (TRUNCATE users CASCADE). Remove DB_TRUNCATE_ON_STARTUP from .env now.");
    }

    // ── Migration 6: Change emp_code "1686011" from MD → RA ───────────────────
    //  This person acts as a Reporting Authority (RA) in the HRMS hierarchy, not
    //  as the MD in the PES system. All their linked data (MonthlyEvaluations,
    //  EmployeeRAHistory, MonthlyPlans) is preserved — only the role column is updated.
    //  Idempotent: the WHERE role='MD' clause means re-running is a safe no-op.
    const [mdToRaCount] = await sequelize.query(
        `UPDATE users SET role = 'RA' WHERE employee_code = '1686011' AND role = 'MD'`
    );
    if (mdToRaCount?.rowCount > 0) {
        console.log("✅ Migration 6: emp_code '1686011' role updated MD → RA");
    }
};

// ─── Backfill EmployeeRAHistory ───────────────────────────────────────────────
//  Runs ONCE after sequelize.sync() creates the employee_ra_histories table.
//  For every employee who already has a reportingAuthorityId but has no history
//  row yet, we seed a single "initial assignment" row:
//    effectiveFrom = employee's createdAt  (best approximation of assignment date)
//    effectiveTo   = NULL                  (still active as of this backfill run)
//    assignedBy    = NULL                  (unknown — pre-history system)
//
//  This is idempotent: the WHERE employeeId NOT IN (existing history) guard
//  means re-running on subsequent restarts is a safe no-op.
// ─────────────────────────────────────────────────────────────────────────────
const backfillRAHistory = async () => {
    // Find all employees / RAs with a reportingAuthorityId set
    const usersWithRA = await User.findAll({
        where: {
            reportingAuthorityId: { [Op.ne]: null },
            role: { [Op.in]: ["EMPLOYEE", "RA"] },
        },
        attributes: ["id", "reportingAuthorityId", "createdAt"],
    });

    if (usersWithRA.length === 0) return;

    // Find which ones already have at least one history row (idempotency guard)
    const alreadySeeded = await EmployeeRAHistory.findAll({
        where: { employeeId: { [Op.in]: usersWithRA.map(u => u.id) } },
        attributes: ["employeeId"],
    });
    const seededIds = new Set(alreadySeeded.map(h => String(h.employeeId)));

    const toInsert = usersWithRA
        .filter(u => !seededIds.has(String(u.id)))
        .map(u => ({
            employeeId: u.id,
            raId: u.reportingAuthorityId,
            effectiveFrom: u.createdAt,   // use account creation date as best proxy
            effectiveTo: null,          // still active
            assignedBy: null,          // unknown — pre-dates the history system
        }));

    if (toInsert.length > 0) {
        await EmployeeRAHistory.bulkCreate(toInsert);
        console.log(`✅ Backfill: seeded ${toInsert.length} initial EmployeeRAHistory row(s)`);
    } else {
        console.log("✅ Backfill: EmployeeRAHistory already up to date — nothing to seed");
    }
};


// ─── STEP 3: async startup — connect DB first, then start server ──────────
const startServer = async () => {
    try {
        // Test the PostgreSQL connection
        await sequelize.authenticate();
        console.log("✅ PostgreSQL connected successfully");

        // Run schema migrations before syncing
        await runMigrations();

        // Sync models → tables
        // alter: true  → ⚠️  AVOID: drops & re-adds FK constraints every restart,
        //                    causing "Unknown constraint" errors in PostgreSQL.
        // force: true  → DROPS and recreates all tables (destructive — dev only).
        // sync()       → ✅ safe: creates missing tables, never touches existing ones.
        await sequelize.sync();   // no alter — schema is already correct
        console.log("✅ All tables synced");

        // Explicitly ensure the employee_ra_histories table exists.
        // sequelize.sync() above should handle it, but this is a safety net
        // in case the model wasn't picked up during the general sync.
        await EmployeeRAHistory.sync();
        console.log("✅ employee_ra_histories table verified/created");

        // Backfill EmployeeRAHistory for pre-existing employees (runs after sync
        // so the table is guaranteed to exist).
        await backfillRAHistory();

        // // ── Startup diagnostic: warn if any RA has no reporting authority ─────
        // // This catches the case where an RA logged in via HRMS SSO before the MD
        // // account was created. These users will have reportingAuthorityId = null,
        // // which means the MD's "RA Plans" tab will show empty for them.
        // // Fix: ensure the MD logs in once, then the RA logs in again to self-heal.
        // const rasWithNoRA = await User.findAll({
        //     where: { role: "RA", reportingAuthorityId: null, isActive: true },
        //     attributes: ["id", "name", "employeeCode"],
        // });
        // if (rasWithNoRA.length > 0) {
        //     console.warn(
        //         `⚠️  SETUP WARNING: ${rasWithNoRA.length} RA user(s) have no reportingAuthorityId set:`,
        //         rasWithNoRA.map(u => `${u.name} (${u.employeeCode})`).join(", ")
        //     );
        //     console.warn(
        //         "   → Ensure the MD account exists, then have each RA log in again to auto-assign the MD."
        //     );
        // }

        // Start server only after DB is ready
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("❌ Startup failed:", error.message);
        process.exit(1);  // stop the process if DB fails
    }
};

startServer();



