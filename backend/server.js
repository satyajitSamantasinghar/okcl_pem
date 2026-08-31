const dotenv = require('dotenv');
dotenv.config();
const app = require("./src/app");
const {
    sequelize,
    User,
    AuditLog,
    Notification,
    EmployeeRAHistory,
    MonthlyPlan,
    MonthlyPlanItem,
    MonthlyAchievement,
    MonthlyAchievementItem,
    MonthlyEvaluation,
    QuarterlyEvaluation,
    YearlyPlan,
    YearlyPlanKra,
    YearlyPlanRevisionLog,
    YearlyPlanEditHistory,
    YearlyAppraisalReport,
    YearlyAppraisalKraAssessment,
    AppraisalQuarterlyEvaluation,
    DeadlineExtension,
} = require("./src/models");
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

    // Migration 7: Add addedVia/addedAt origin-tracking to MonthlyPlanItem and
    // MonthlyAchievementItem rows — lets the RA/HRD/MD evaluation views tell a
    // plan/progress item added via the mid-cycle "Add More Plans"/"Add More
    // Progress" flow apart from one submitted with the original monthly plan.
    //
    // added_via is a plain constant default ('INITIAL_SUBMISSION'), so
    // Postgres can add it as NOT NULL in one step — same pattern as
    // auth_provider in Migration 1 above.
    //
    // added_at needs a *value*, not a constant, so it's added in three steps
    // (nullable → backfill existing rows → enforce NOT NULL) instead of one
    // addColumn with a DEFAULT CURRENT_TIMESTAMP. A volatile default like
    // that can't use Postgres 11+'s fast metadata-only column add — it forces
    // a full table rewrite under an ACCESS EXCLUSIVE lock for however long
    // that takes. Splitting it out means the schema change itself is always
    // instant, and the one-time backfill UPDATE is a normal write the table
    // already handles every day. The app itself never depends on a DB-level
    // default for added_at — employeeController.js always stamps it
    // explicitly on every insert — so once existing rows are backfilled this
    // column never needs a default at all.
    const planItemDesc = await qi.describeTable("monthly_plan_items");
    if (!planItemDesc.added_via) {
        await qi.addColumn("monthly_plan_items", "added_via", {
            type: DataTypes.ENUM("INITIAL_SUBMISSION", "ADD_MORE"),
            allowNull: false,
            defaultValue: "INITIAL_SUBMISSION",
        });
        console.log("✅ Migration: added added_via column to monthly_plan_items table");
    }
    if (!planItemDesc.added_at) {
        await qi.addColumn("monthly_plan_items", "added_at", {
            type: DataTypes.DATE,
            allowNull: true,
        });
        await sequelize.query(
            `UPDATE monthly_plan_items SET added_at = NOW() WHERE added_at IS NULL`
        );
        await qi.changeColumn("monthly_plan_items", "added_at", {
            type: DataTypes.DATE,
            allowNull: false,
        });
        console.log("✅ Migration: added added_at column to monthly_plan_items table (backfilled existing rows, then set NOT NULL)");
    }

    const achievementItemDesc = await qi.describeTable("monthly_achievement_items");
    if (!achievementItemDesc.added_via) {
        await qi.addColumn("monthly_achievement_items", "added_via", {
            type: DataTypes.ENUM("INITIAL_SUBMISSION", "ADD_MORE"),
            allowNull: false,
            defaultValue: "INITIAL_SUBMISSION",
        });
        console.log("✅ Migration: added added_via column to monthly_achievement_items table");
    }
    if (!achievementItemDesc.added_at) {
        await qi.addColumn("monthly_achievement_items", "added_at", {
            type: DataTypes.DATE,
            allowNull: true,
        });
        await sequelize.query(
            `UPDATE monthly_achievement_items SET added_at = NOW() WHERE added_at IS NULL`
        );
        await qi.changeColumn("monthly_achievement_items", "added_at", {
            type: DataTypes.DATE,
            allowNull: false,
        });
        console.log("✅ Migration: added added_at column to monthly_achievement_items table (backfilled existing rows, then set NOT NULL)");
    }

    // Migration 8: Add planItemId (FK → monthly_plan_items) to
    // MonthlyAchievementItem — replaces positional (planIndex-based) linking
    // between plan items and their progress entries with a real foreign
    // key. planIndex is kept as a legacy/audit field only; it's never used
    // for matching once this column is populated. Nullable because a
    // handful of very old rows may have no MonthlyPlanItem to point at
    // (e.g. a plan that predates MonthlyPlanItem existing at all) — those
    // stay unlinked rather than blocking the migration. See
    // linkAchievementItemsToPlanItems() below for the one-time backfill
    // that populates this for existing rows, and employeeController.js for
    // where newly created rows set it directly going forward.
    const achievementItemDescForFk = await qi.describeTable("monthly_achievement_items");
    if (!achievementItemDescForFk.plan_item_id) {
        await qi.addColumn("monthly_achievement_items", "plan_item_id", {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: "monthly_plan_items", key: "id" },
            onDelete: "CASCADE",
        });
        console.log("✅ Migration: added plan_item_id column (FK → monthly_plan_items) to monthly_achievement_items table");
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

// ─── One-time Data Repair: normalize itemOrder / planIndex ──────────────────
//  Fixes rows affected by a bug in employeeController.js's "Add More
//  Plans"/"Add More Progress" append logic: the next itemOrder/planIndex was
//  computed from existingItems.length (a row COUNT) instead of
//  MAX(itemOrder)/MAX(planIndex). Those two only agree when the existing
//  values happen to be a perfectly gapless 0..n-1 sequence — not guaranteed
//  (a concurrent append, a historical edge case, etc.). When they disagreed,
//  a newly appended item could receive an itemOrder LOWER than items already
//  in the plan, so it sorted first instead of last, and — because
//  MonthlyAchievementItem is linked to MonthlyPlanItem purely by array
//  POSITION, not a foreign key — every achievement entry after that point
//  silently paired with the wrong plan item. The append logic itself is
//  already fixed to use MAX going forward; this repairs rows written before
//  that fix.
//
//  Repair rule, per plan / per achievement: group items into
//  INITIAL_SUBMISSION (always first) and ADD_MORE (always after), preserving
//  relative order WITHIN each group — INITIAL_SUBMISSION rows by their
//  current itemOrder/planIndex (never touched by the bug, so still correct
//  relative to each other), ADD_MORE rows by addedAt (a real timestamp,
//  unaffected by the bug, so still chronologically correct even across
//  multiple separate append calls) — then rewrite itemOrder/planIndex as a
//  clean dense 0..n-1 sequence in that order.
//
//  Idempotent: a group already in the correct order is rewritten to the same
//  values, so re-running this on every restart is a safe no-op. Safe to
//  leave running indefinitely, but can be removed once you've confirmed (via
//  its log output) that a run found nothing left to repair.
// ─────────────────────────────────────────────────────────────────────────────
const repairItemOrdering = async () => {
    const repairTable = async (Model, parentKey, orderField) => {
        const rows = await Model.findAll({
            attributes: ["id", parentKey, orderField, "addedVia", "addedAt"],
            raw: true,
        });

        const byParent = new Map();
        for (const row of rows) {
            const key = String(row[parentKey]);
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(row);
        }

        let repairedGroups = 0;
        let repairedRows = 0;

        for (const items of byParent.values()) {
            const sorted = [...items].sort((a, b) => {
                if (a.addedVia !== b.addedVia) {
                    return a.addedVia === "ADD_MORE" ? 1 : -1;
                }
                if (a.addedVia === "ADD_MORE") {
                    return new Date(a.addedAt) - new Date(b.addedAt);
                }
                return a[orderField] - b[orderField];
            });

            let changedInGroup = false;
            for (let i = 0; i < sorted.length; i++) {
                if (sorted[i][orderField] !== i) {
                    await Model.update({ [orderField]: i }, { where: { id: sorted[i].id } });
                    changedInGroup = true;
                    repairedRows++;
                }
            }
            if (changedInGroup) repairedGroups++;
        }

        return { repairedGroups, repairedRows };
    };

    const planResult = await repairTable(MonthlyPlanItem, "monthlyPlanId", "itemOrder");
    if (planResult.repairedRows > 0) {
        console.log(`✅ Data Repair: fixed itemOrder for ${planResult.repairedRows} MonthlyPlanItem row(s) across ${planResult.repairedGroups} plan(s)`);
    } else {
        console.log("✅ Data Repair: MonthlyPlanItem.itemOrder already correct — nothing to fix");
    }

    const achResult = await repairTable(MonthlyAchievementItem, "monthlyAchievementId", "planIndex");
    if (achResult.repairedRows > 0) {
        console.log(`✅ Data Repair: fixed planIndex for ${achResult.repairedRows} MonthlyAchievementItem row(s) across ${achResult.repairedGroups} achievement(s)`);
    } else {
        console.log("✅ Data Repair: MonthlyAchievementItem.planIndex already correct — nothing to fix");
    }
};

// ─── One-time Data Backfill: link MonthlyAchievementItem → MonthlyPlanItem ───
//  Populates plan_item_id for MonthlyAchievementItem rows that predate the
//  column (see Migration 8 above). Must run AFTER repairItemOrdering() —
//  the backfill pairs each achievement row with a plan item by matching
//  their (now-correct) relative position, so it depends on plan item
//  ordering already being trustworthy.
//
//  Pairing rule, per achievement: sort its rows by planIndex, sort the
//  parent plan's items by itemOrder, and pair position-for-position (1st
//  achievement row → 1st plan item, 2nd → 2nd, ...). This is the same
//  correspondence the app has always implicitly relied on — the point of
//  this backfill isn't to guess anything new, it's to convert that implicit,
//  order-dependent correspondence into an explicit, order-independent one,
//  exactly once, so nothing has to rely on array position ever again.
//
//  Defensive: if pairing would assign the same plan item to two different
//  achievement rows (only possible from already-corrupted historical data,
//  e.g. duplicate planIndex values), only the first is linked — the rest
//  are left unlinked (plan_item_id stays NULL) and logged for manual review,
//  rather than guessed at or silently overwritten.
//
//  Idempotent: only rows with plan_item_id IS NULL are touched, so
//  re-running after the first successful pass is a fast no-op.
// ─────────────────────────────────────────────────────────────────────────────
const linkAchievementItemsToPlanItems = async () => {
    const unlinked = await MonthlyAchievementItem.findAll({
        where: { planItemId: null },
        raw: true,
    });
    if (unlinked.length === 0) {
        console.log("✅ Data Backfill: MonthlyAchievementItem.planItemId already populated — nothing to link");
        return;
    }

    const achievementIds = [...new Set(unlinked.map(r => r.monthlyAchievementId))];
    const achievements = await MonthlyAchievement.findAll({
        where: { id: { [Op.in]: achievementIds } },
        attributes: ["id", "monthlyPlanId"],
        raw: true,
    });
    const planIdByAchievementId = new Map(achievements.map(a => [a.id, a.monthlyPlanId]));

    const planIds = [...new Set(achievements.map(a => a.monthlyPlanId))];
    const planItems = await MonthlyPlanItem.findAll({
        where: { monthlyPlanId: { [Op.in]: planIds } },
        attributes: ["id", "monthlyPlanId", "itemOrder"],
        order: [["itemOrder", "ASC"]],
        raw: true,
    });
    const planItemsByPlanId = new Map();
    for (const item of planItems) {
        const key = item.monthlyPlanId;
        if (!planItemsByPlanId.has(key)) planItemsByPlanId.set(key, []);
        planItemsByPlanId.get(key).push(item);
    }

    const byAchievement = new Map();
    for (const row of unlinked) {
        const key = row.monthlyAchievementId;
        if (!byAchievement.has(key)) byAchievement.set(key, []);
        byAchievement.get(key).push(row);
    }

    let linkedCount = 0;
    let skippedCount = 0;
    for (const [achievementId, rows] of byAchievement.entries()) {
        const planId = planIdByAchievementId.get(achievementId);
        const items = planId ? (planItemsByPlanId.get(planId) || []) : [];
        const sortedRows = [...rows].sort((a, b) => a.planIndex - b.planIndex);

        const usedPlanItemIds = new Set();
        for (let i = 0; i < sortedRows.length; i++) {
            const planItem = items[i];
            if (!planItem || usedPlanItemIds.has(planItem.id)) {
                skippedCount++;
                continue;
            }
            usedPlanItemIds.add(planItem.id);
            await MonthlyAchievementItem.update(
                { planItemId: planItem.id },
                { where: { id: sortedRows[i].id } }
            );
            linkedCount++;
        }
    }

    console.log(`✅ Data Backfill: linked ${linkedCount} MonthlyAchievementItem row(s) to their MonthlyPlanItem`
        + (skippedCount > 0 ? ` (${skippedCount} row(s) left unlinked — no matching plan item found, needs manual review)` : ""));
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

// ─── One-time Employee Hard-Delete ───────────────────────────────────────────
//  Permanently removes the employees listed in TARGET_EMP_CODES and ALL of
//  their associated data (plans, achievements, evaluations, appraisals, etc.)
//  in the correct FK-safe order (leaf → root) inside a single transaction.
//
//  Safety guarantees:
//    • Idempotent — destroy() on already-gone rows is always a safe no-op.
//      Re-deploying after this block is commented out causes zero side effects.
//    • SERIALIZABLE transaction — all-or-nothing; any error rolls back fully.
//    • Missing employee codes are silently skipped (warn only), so the server
//      still starts even if some codes were already deleted.
//    • Wrapped in try/catch — a failure here NEVER crashes the server.
//
//  ⚠️  COMMENT THIS ENTIRE BLOCK OUT after the next successful deployment.
// ─────────────────────────────────────────────────────────────────────────────
const deleteTargetEmployees = async () => {
    const TARGET_EMP_CODES = [
        ...new Set(["152", "1015", "1031", "1042", "1052", "1036", "1016", "39", "36", "1051"]),
    ];

    try {
        // ── Resolve employee codes → UUIDs ────────────────────────────────────
        const targetUsers = await User.findAll({
            where: { employeeCode: { [Op.in]: TARGET_EMP_CODES } },
            attributes: ["id", "employeeCode", "name"],
        });

        if (targetUsers.length === 0) {
            console.log("✅ Employee Cleanup: none of the target employees found — skipping.");
            return;
        }

        const foundCodes = targetUsers.map(u => u.employeeCode);
        const missingCodes = TARGET_EMP_CODES.filter(c => !foundCodes.includes(c));
        if (missingCodes.length > 0) {
            console.warn(`⚠️  Employee Cleanup: codes not found in DB (already deleted or never existed): ${missingCodes.join(", ")}`);
        }

        const empIds = targetUsers.map(u => u.id);
        const empWhere = { [Op.in]: empIds };
        console.log(`🗑️  Employee Cleanup: deleting ${targetUsers.length} employee(s): ${targetUsers.map(u => `${u.name} (${u.employeeCode})`).join(", ")}`);

        const t = await sequelize.transaction({
            isolationLevel: require("sequelize").Transaction.ISOLATION_LEVELS.SERIALIZABLE,
        });

        try {
            // Collect child-record IDs before any deletes
            const appraisalReports = await YearlyAppraisalReport.findAll({
                where: { employeeId: empWhere }, attributes: ["id"], transaction: t,
            });
            const appraisalReportIds = appraisalReports.map(r => r.id);

            const quarterlyEvals = await QuarterlyEvaluation.findAll({
                where: { employeeId: empWhere }, attributes: ["id"], transaction: t,
            });
            const quarterlyEvalIds = quarterlyEvals.map(r => r.id);

            const achievements = await MonthlyAchievement.findAll({
                where: { employeeId: empWhere }, attributes: ["id"], transaction: t,
            });
            const achievementIds = achievements.map(a => a.id);

            const plans = await MonthlyPlan.findAll({
                where: { employeeId: empWhere }, attributes: ["id"], transaction: t,
            });
            const planIds = plans.map(p => p.id);

            const yearlyPlans = await YearlyPlan.findAll({
                where: { employeeId: empWhere }, attributes: ["id"], transaction: t,
            });
            const yearlyPlanIds = yearlyPlans.map(yp => yp.id);

            // Step 1 — AppraisalQuarterlyEvaluation (junction)
            if (appraisalReportIds.length > 0 || quarterlyEvalIds.length > 0) {
                const aqeOr = [];
                if (appraisalReportIds.length > 0) aqeOr.push({ yearlyAppraisalReportId: { [Op.in]: appraisalReportIds } });
                if (quarterlyEvalIds.length > 0) aqeOr.push({ quarterlyEvaluationId: { [Op.in]: quarterlyEvalIds } });
                await AppraisalQuarterlyEvaluation.destroy({ where: { [Op.or]: aqeOr }, transaction: t });
            }

            // Step 2 — YearlyAppraisalKraAssessment
            if (appraisalReportIds.length > 0) {
                await YearlyAppraisalKraAssessment.destroy({
                    where: { yearlyAppraisalReportId: { [Op.in]: appraisalReportIds } }, transaction: t,
                });
            }

            // Step 3 — YearlyAppraisalReport
            await YearlyAppraisalReport.destroy({ where: { employeeId: empWhere }, transaction: t });

            // Step 4 — QuarterlyEvaluation
            await QuarterlyEvaluation.destroy({ where: { employeeId: empWhere }, transaction: t });

            // Step 5 — MonthlyEvaluation
            await MonthlyEvaluation.destroy({ where: { employeeId: empWhere }, transaction: t });

            // Step 6 — MonthlyAchievementItem
            if (achievementIds.length > 0) {
                await MonthlyAchievementItem.destroy({
                    where: { monthlyAchievementId: { [Op.in]: achievementIds } }, transaction: t,
                });
            }

            // Step 7 — MonthlyAchievement
            await MonthlyAchievement.destroy({ where: { employeeId: empWhere }, transaction: t });

            // Step 8 — MonthlyPlanItem
            if (planIds.length > 0) {
                await MonthlyPlanItem.destroy({
                    where: { monthlyPlanId: { [Op.in]: planIds } }, transaction: t,
                });
            }

            // Step 9 — MonthlyPlan
            await MonthlyPlan.destroy({ where: { employeeId: empWhere }, transaction: t });

            // Steps 10–12 — YearlyPlan children
            if (yearlyPlanIds.length > 0) {
                const ypOpt = { where: { yearlyPlanId: { [Op.in]: yearlyPlanIds } }, transaction: t };
                await YearlyPlanKra.destroy({ ...ypOpt });
                await YearlyPlanRevisionLog.destroy({ ...ypOpt });
                await YearlyPlanEditHistory.destroy({ ...ypOpt });
            }

            // Step 13 — YearlyPlan
            await YearlyPlan.destroy({ where: { employeeId: empWhere }, transaction: t });

            // Step 14 — EmployeeRAHistory (covers employeeId, raId, and assignedBy)
            await EmployeeRAHistory.destroy({
                where: { [Op.or]: [{ employeeId: empWhere }, { raId: empWhere }, { assignedBy: empWhere }] },
                transaction: t,
            });

            // Step 15 — DeadlineExtension (covers employeeId and extendedById)
            await DeadlineExtension.destroy({
                where: { [Op.or]: [{ employeeId: empWhere }, { extendedById: empWhere }] },
                transaction: t,
            });

            // Step 16 — AuditLog
            await AuditLog.destroy({ where: { userId: empWhere }, transaction: t });

            // Step 17 — Notification
            await Notification.destroy({ where: { userId: empWhere }, transaction: t });

            // Step 18a — Null out self-referencing FK on subordinates of any deleted RA
            await User.update(
                { reportingAuthorityId: null },
                { where: { reportingAuthorityId: empWhere }, transaction: t }
            );

            // Step 18b — Delete the User rows (must be last)
            await User.destroy({ where: { id: empWhere }, transaction: t });

            await t.commit();
            console.log(`✅ Employee Cleanup: successfully deleted ${targetUsers.length} employee(s) and all associated data.`);

        } catch (txErr) {
            await t.rollback();
            throw txErr;  // re-throw so the outer catch logs it
        }

    } catch (cleanupErr) {
        // Log but do NOT rethrow — a cleanup failure must never prevent the server
        // from starting. Fix manually if needed.
        console.error("❌ Employee Cleanup failed (server will still start):", cleanupErr.message);
        console.error(cleanupErr.stack);
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

        // Repair any itemOrder/planIndex rows corrupted by the "Add More"
        // append bug described above. Must run after runMigrations() (needs
        // the added_via/added_at columns) and is safe to run before sync().
        await repairItemOrdering();

        // Backfill the new plan_item_id FK for existing MonthlyAchievementItem
        // rows. Must run after both runMigrations() (needs the plan_item_id
        // column) and repairItemOrdering() (needs trustworthy item ordering
        // to pair rows correctly).
        await linkAchievementItemsToPlanItems();

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

        // One-time employee hard-delete (152, 1015, 1031, 1042, 1052, 1036, 1016, 39, 36)
        // ⚠️  COMMENT THIS LINE OUT after the next successful deployment.
        await deleteTargetEmployees();

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