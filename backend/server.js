
const dotenv = require('dotenv');
dotenv.config();
const app = require("./src/app");
const { sequelize, EmployeeRAHistory, User, MonthlyPlan, MonthlyPlanItem, MonthlyAchievement, MonthlyAchievementItem, MonthlyEvaluation, DeadlineExtension } = require("./src/models");
const { DataTypes, Op } = require("sequelize");
const { verifyEmailConnection } = require('./src/services/email');


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
    // const [mdToRaCount] = await sequelize.query(
    //     `UPDATE users SET role = 'RA' WHERE employee_code = '1686011' AND role = 'MD'`
    // );
    // if (mdToRaCount?.rowCount > 0) {
    //     console.log("✅ Migration 6: emp_code '1686011' role updated MD → RA");
    // }
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


// ─── One-time Monthly Plan Deletion ──────────────────────────────────────────
//  Deletes the July 2026 monthly plans for four employees, including ALL
//  dependent rows first to avoid FK-constraint violations:
//    MonthlyEvaluation (FK → monthly_plans.id, no CASCADE)
//    MonthlyAchievementItem (FK → monthly_achievements.id, CASCADE — but we
//                            delete explicitly to be safe)
//    MonthlyAchievement (FK → monthly_plans.id, no CASCADE)
//    MonthlyPlanItem (FK → monthly_plans.id, CASCADE — explicit for clarity)
//    MonthlyPlan (the target row)
//
//  Idempotent: destroy() on already-gone rows is always a safe no-op.
//  Wrapped in its own try/catch so a DB error here NEVER crashes the server.
//
//  Employee codes: 1686029, 1686017, 1686008, 1035
//  Target month  : 2026-07
//
//  ⚠️  REMOVE THIS BLOCK after the next successful deployment to keep startup lean.
// ─────────────────────────────────────────────────────────────────────────────
// const deleteJuly2026Plans = async () => {
//     const TARGET_EMP_CODES = ["1686013", "1686012"];
//     const TARGET_MONTH = "2026-07";

//     try {
//         // Step 1: Resolve employee UUIDs from their employee codes
//         const targetUsers = await User.findAll({
//             where: { employeeCode: { [Op.in]: TARGET_EMP_CODES } },
//             attributes: ["id", "employeeCode", "name"],
//         });

//         if (targetUsers.length === 0) {
//             console.log("⚠️  Monthly Plan Cleanup: none of the target employees found in DB — skipping.");
//             return;
//         }

//         const targetUserIds = targetUsers.map(u => u.id);

//         // Step 2: Find the target monthly plans
//         const plansToDelete = await MonthlyPlan.findAll({
//             where: {
//                 employeeId: { [Op.in]: targetUserIds },
//                 month: TARGET_MONTH,
//             },
//             attributes: ["id", "employeeId", "month", "status"],
//         });

//         if (plansToDelete.length === 0) {
//             console.log(`✅ Monthly Plan Cleanup: no ${TARGET_MONTH} plans found for the target employees — nothing to delete.`);
//             return;
//         }

//         const planIds = plansToDelete.map(p => p.id);

//         // Step 3: Delete MonthlyEvaluations that reference these plans
//         //  (FK monthly_evaluations.monthly_plan_id → monthly_plans.id, NO CASCADE)
//         await MonthlyEvaluation.destroy({
//             where: { monthlyPlanId: { [Op.in]: planIds } },
//         });

//         // Step 4: Find MonthlyAchievements linked to these plans, then delete
//         //  their child items before deleting the achievement rows themselves.
//         //  (FK monthly_achievements.monthly_plan_id → monthly_plans.id, NO CASCADE)
//         const achievements = await MonthlyAchievement.findAll({
//             where: { monthlyPlanId: { [Op.in]: planIds } },
//             attributes: ["id"],
//         });
//         if (achievements.length > 0) {
//             const achIds = achievements.map(a => a.id);
//             // Step 4a: Delete achievement items (CASCADE, but explicit for safety)
//             await MonthlyAchievementItem.destroy({
//                 where: { monthlyAchievementId: { [Op.in]: achIds } },
//             });
//             // Step 4b: Delete the achievement rows
//             await MonthlyAchievement.destroy({
//                 where: { id: { [Op.in]: achIds } },
//             });
//         }

//         // Step 5: Delete plan items (CASCADE, but explicit for safety)
//         const deletedItemCount = await MonthlyPlanItem.destroy({
//             where: { monthlyPlanId: { [Op.in]: planIds } },
//         });

//         // Step 6: Delete the plans themselves — all FK children are already gone
//         const deletedPlanCount = await MonthlyPlan.destroy({
//             where: { id: { [Op.in]: planIds } },
//         });

//         const affectedCodes = targetUsers
//             .filter(u => plansToDelete.some(p => String(p.employeeId) === String(u.id)))
//             .map(u => `${u.name} (${u.employeeCode})`);

//         console.log(
//             `✅ Monthly Plan Cleanup: deleted ${deletedPlanCount} plan(s) + ${deletedItemCount} item(s) ` +
//             `for ${TARGET_MONTH}. Affected employees: ${affectedCodes.join(", ")}`
//         );
//     } catch (cleanupErr) {
//         // Log but do NOT rethrow — a cleanup failure must never prevent the server
//         // from starting. Fix the data manually if needed.
//         console.error("❌ Monthly Plan Cleanup failed (server will still start):", cleanupErr.message);
//     }
// };

// ─── One-time RA Fix: Branch-3 employees with missing ra_id ──────────────────
//  ABHINAV DAS (1056), PRIYANKA BEHERA (1037), DILIP KUMAR BEHERA (1010)
//  all belong to branch 3 and have "ra_id": "" in their HRMS SSO tokens.
//  This means the SSO flow cannot auto-resolve their Reporting Authority.
//  Fix: assign them to the RA with emp_code "1686008" in both the users table
//  and the EmployeeRAHistory table.
//
//  Safety guarantees:
//    • Idempotent — checks current reportingAuthorityId before acting, so
//      re-running on subsequent server restarts is always a safe no-op.
//    • No CASCADE risk — only touches users.reporting_authority_id and
//      employee_ra_histories rows. No plan/evaluation data is touched.
//    • Wrapped in try/catch — a failure here NEVER crashes the server.
//
//  ⚠️  REMOVE THIS BLOCK after the next successful deployment to keep startup lean.
// ─────────────────────────────────────────────────────────────────────────────
// const fixMissingRAForBranch3Employees = async () => {
//     const TARGET_EMP_CODES = ["1056", "1037", "1010"];
//     const RA_EMP_CODE = "1686008";

//     try {
//         // Step 1: Find the RA user (1686008) — their UUID is what we store
//         const raUser = await User.findOne({
//             where: { employeeCode: RA_EMP_CODE },
//             attributes: ["id", "name", "employeeCode"],
//         });

//         if (!raUser) {
//             console.warn(
//                 `⚠️  RA Fix: RA with emp_code "${RA_EMP_CODE}" not found in DB. ` +
//                 `Ensure this employee logs in via HRMS SSO first, then restart the server.`
//             );
//             return;
//         }

//         // Step 2: Find the three employees
//         const targetEmployees = await User.findAll({
//             where: { employeeCode: { [Op.in]: TARGET_EMP_CODES } },
//             attributes: ["id", "name", "employeeCode", "reportingAuthorityId"],
//         });

//         if (targetEmployees.length === 0) {
//             console.log("⚠️  RA Fix: none of the three target employees found in DB — skipping.");
//             return;
//         }

//         const now = new Date();
//         let fixedCount = 0;

//         for (const emp of targetEmployees) {
//             // Idempotency guard: skip if already pointing to the correct RA
//             if (String(emp.reportingAuthorityId) === String(raUser.id)) {
//                 console.log(`✅ RA Fix: ${emp.name} (${emp.employeeCode}) already assigned to RA ${RA_EMP_CODE} — skipping.`);
//                 continue;
//             }

//             // Step 3a: Update the users table
//             emp.reportingAuthorityId = raUser.id;
//             await emp.save();

//             // Step 3b: Close any currently-open EmployeeRAHistory row
//             //  (effectiveTo IS NULL means it is the active assignment)
//             await EmployeeRAHistory.update(
//                 { effectiveTo: now },
//                 { where: { employeeId: emp.id, effectiveTo: null } }
//             );

//             // Step 3c: Open a new EmployeeRAHistory row for the corrected RA
//             await EmployeeRAHistory.create({
//                 employeeId: emp.id,
//                 raId: raUser.id,
//                 effectiveFrom: now,
//                 effectiveTo: null,
//                 assignedBy: null,   // system-driven correction — no admin actor
//             });

//             console.log(`✅ RA Fix: ${emp.name} (${emp.employeeCode}) → RA ${raUser.name} (${RA_EMP_CODE})`);
//             fixedCount++;
//         }

//         if (fixedCount === 0) {
//             console.log("✅ RA Fix: all target employees already correctly assigned — nothing to do.");
//         } else {
//             console.log(`✅ RA Fix: successfully updated ${fixedCount} employee(s) to RA ${RA_EMP_CODE}.`);
//         }

//     } catch (raFixErr) {
//         // Log but do NOT rethrow — this fix must never prevent the server from starting.
//         console.error("❌ RA Fix failed (server will still start):", raFixErr.message);
//     }
// };

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

        // One-time monthly plan deletion for July 2026
        // await deleteJuly2026Plans();

        // One-time RA fix: assign emp_codes 1056, 1037, 1010 → RA 1686008
        // (their HRMS tokens carry ra_id: "" so SSO cannot resolve this automatically)
        // await fixMissingRAForBranch3Employees();


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
         await verifyEmailConnection();
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("❌ Startup failed:", error.message);
        process.exit(1);  // stop the process if DB fails
    }
};

startServer();



