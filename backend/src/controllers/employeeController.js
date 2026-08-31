// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYEE CONTROLLER  —  Mongoose → Sequelize conversion
//
//  TOP-LEVEL CHANGES (applies to every function):
//  A. Single import from '../models' instead of per-file require
//  B. All _id references become .id
//  C. find(filter) → findAll({ where: filter })
//  D. findById(id) → findByPk(id)
//  E. findOne({...}) → findOne({ where: {...} })
//  F. .populate(field, attrs) → include: [{ model, as, attributes }]
//  G. deleteMany / findByIdAndUpdate → destroy / update with where clause
//  H. $in / $ne / $or operators → Op.in / Op.ne / Op.or
//
//  SCHEMA-SPECIFIC CHANGES:
//  I.  planItems[] (MonthlyPlan embedded array) → MonthlyPlanItem table rows
//      Handled with transaction: destroy old items + bulkCreate new ones
//  J.  planAchievements[] (MonthlyAchievement embedded array) → MonthlyAchievementItem rows
//      Handled with transaction: destroy old + bulkCreate new
//  K.  kras[] (YearlyPlan embedded array) → YearlyPlanKra table rows
//      Handled with transaction: destroy old + bulkCreate new
//  L.  revisionLog.push({}) → YearlyPlanRevisionLog.create({})
//  M.  kraAssessments[] (YearlyAppraisalReport embedded array) → YearlyAppraisalKraAssessment rows
//
//  PRE-SAVE HOOKS → moved into controller:
//  • MonthlyPlan: planDetails auto-derived from planItems before save
//  • MonthlyAchievement: achievementDetails auto-derived from planAchievements before save
// ─────────────────────────────────────────────────────────────────────────────

const {
  sequelize,
  User,
  MonthlyPlan,
  MonthlyPlanItem,
  MonthlyAchievement,
  MonthlyAchievementItem,
  MonthlyEvaluation,
  YearlyPlan,
  YearlyPlanKra,
  YearlyPlanRevisionLog,
  YearlyAppraisalReport,
  YearlyAppraisalKraAssessment,
  AuditLog,
} = require("../models");

const { Op } = require("sequelize");

// Deadline helpers — mirrors raController imports so we can compute effective deadlines
const { parseDeadlineConfig, normalizeRole, getExtensionCeiling } = require("./configController");
const { getEffectiveDeadline } = require("../utils/deadlineResolver");
const { buildDeadlineDate } = require("../utils/dateHelpers");
const { notifySubmission, notifyAddition } = require("../services/notificationService");


// ─────────────────────────────────────────────────────────────────────────────
// EMAIL NOTIFICATION HELPERS
//
// Deliberately NOT awaited by callers, and deliberately fetch fresh data
// AFTER the transaction commits — never pass transaction-scoped instances
// into these, since a notification must only fire for data that is
// actually persisted, not data that might still roll back.
//
// Both helpers swallow their own errors: a failed/slow email must never
// affect the API response the employee already received.
// ─────────────────────────────────────────────────────────────────────────────
async function notifyRAOfSubmission(employeeId, period, type) {
  try {
    const employee = await User.findByPk(employeeId, {
      attributes: ["id", "name", "email", "reportingAuthorityId"],
    });
    if (!employee?.reportingAuthorityId) return; // no RA assigned — nothing to notify

    const reportingAuthority = await User.findByPk(employee.reportingAuthorityId, {
      attributes: ["id", "name", "email"],
    });

    await notifySubmission({ employee, reportingAuthority, period, type });
  } catch (err) {
    console.error(`[notification] ${type} submission notice failed for employee ${employeeId}:`, err.message);
  }
}

// Sibling of notifyRAOfSubmission, but for the "Add More Plans" mid-cycle
// flow: items appended to a Plan/Achievement that was already submitted
// (and already triggered notifyRAOfSubmission once). Deliberately routed
// through notifyAddition/additionalItemsTemplate instead of notifySubmission
// so the RA gets a "new items added" notice, not a duplicate "submitted"
// notice implying a fresh first-time submission.
async function notifyRAOfAddition(employeeId, period, type, itemCount) {
  try {
    const employee = await User.findByPk(employeeId, {
      attributes: ["id", "name", "email", "reportingAuthorityId"],
    });
    if (!employee?.reportingAuthorityId) return; // no RA assigned — nothing to notify

    const reportingAuthority = await User.findByPk(employee.reportingAuthorityId, {
      attributes: ["id", "name", "email"],
    });

    await notifyAddition({ employee, reportingAuthority, period, type, itemCount });
  } catch (err) {
    console.error(`[notification] ${type} addition notice failed for employee ${employeeId}:`, err.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. SUBMIT MONTHLY PLAN
//    CHANGE I: planItems array → MonthlyPlanItem rows in a transaction
//    CHANGE: Mongoose pre-save hook for planDetails is now done here inline
// ─────────────────────────────────────────────────────────────────────────────
exports.submitMonthlyPlan = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { month, planDetails, planItems, status } = req.body;
    const planStatus = status === "DRAFT" ? "DRAFT" : "PENDING";

    // Derive planDetails from planItems if array supplied (replaces pre-save hook)
    const resolvedPlanDetails =
      Array.isArray(planItems) && planItems.length > 0
        ? planItems.filter(Boolean).join("\n")
        : planDetails || "";

    // CHANGE: findOne({ employeeId, month }) → findOne({ where: { employeeId, month } })
    const existingPlan = await MonthlyPlan.findOne({
      where: { employeeId: req.user.userId, month },
      transaction: t,
    });

    if (existingPlan) {
      if (existingPlan.status === "REJECTED") {
        existingPlan.planDetails = resolvedPlanDetails;
        existingPlan.status = planStatus;
        existingPlan.mdRemarks = null;
        existingPlan.version = (existingPlan.version || 1) + 1;
        // BUGFIX: only stamp submittedAt when this is an actual submission (PENDING),
        // not a draft save — otherwise the UI shows a false "Submitted" date.
        if (planStatus === "PENDING") existingPlan.submittedAt = new Date();
        await existingPlan.save({ transaction: t });

        // CHANGE I: replace planItems rows
        if (Array.isArray(planItems) && planItems.length > 0) {
          await MonthlyPlanItem.destroy({
            where: { monthlyPlanId: existingPlan.id },
            transaction: t,
          });
          await MonthlyPlanItem.bulkCreate(
            planItems.filter(Boolean).map((text, idx) => ({
              monthlyPlanId: existingPlan.id,
              itemText: text,
              itemOrder: idx,
              // A REJECTED→resubmit replaces the entire item set from
              // scratch, so every row here is an "original" item for the
              // new version — never ADD_MORE.
              addedVia: "INITIAL_SUBMISSION",
              addedAt: new Date(),
            })),
            { transaction: t }
          );
        }

        // CHANGE: findOneAndUpdate → findOne + update
        const existingEval = await MonthlyEvaluation.findOne({
          where: { employeeId: req.user.userId, month },
          transaction: t,
        });
        if (existingEval) {
          await existingEval.update(
            { score: 0, remarks: "", status: "PENDING", monthlyPlanId: existingPlan.id },
            { transaction: t }
          );
        }

        // CHANGE: deleteMany → destroy({ where: {...} })
        await MonthlyAchievement.destroy({
          where: { employeeId: req.user.userId, monthlyPlanId: existingPlan.id },
          transaction: t,
        });

        // CHANGE: entityId stored as String (polymorphic ref, no FK in PG)
        await AuditLog.create(
          { userId: req.user.userId, action: "RESUBMIT", entityType: "MONTHLY_PLAN", entityId: String(existingPlan.id), ipAddress: req.ip },
          { transaction: t }
        );

        await t.commit();
        if (planStatus === "PENDING") {
          notifyRAOfSubmission(req.user.userId, month, "Monthly Plan");
        }
        return res.json({ message: "Plan resubmitted successfully", monthlyPlanId: existingPlan.id });
      }

      if (existingPlan.status === "DRAFT") {
        existingPlan.planDetails = resolvedPlanDetails;
        existingPlan.status = planStatus;
        // BUGFIX: previously this always stamped "now", so re-saving a draft
        // (status staying DRAFT) showed a false "Submitted" date on the UI.
        // Only stamp submittedAt when the plan is actually moving to PENDING.
        if (planStatus === "PENDING") existingPlan.submittedAt = new Date();
        await existingPlan.save({ transaction: t });

        if (Array.isArray(planItems) && planItems.length > 0) {
          await MonthlyPlanItem.destroy({ where: { monthlyPlanId: existingPlan.id }, transaction: t });
          await MonthlyPlanItem.bulkCreate(
            planItems.filter(Boolean).map((text, idx) => ({
              monthlyPlanId: existingPlan.id,
              itemText: text,
              itemOrder: idx,
              // Draft → submit still replaces the whole set; these are all
              // part of the original submission, not later additions.
              addedVia: "INITIAL_SUBMISSION",
              addedAt: new Date(),
            })),
            { transaction: t }
          );
        }

        if (planStatus === "PENDING") {
          const user = await User.findByPk(req.user.userId, { transaction: t });
          if (user?.reportingAuthorityId) {
            const existingEval = await MonthlyEvaluation.findOne({
              where: { employeeId: req.user.userId, month },
              transaction: t,
            });
            if (!existingEval) {
              // If the submitter is an RA, their evaluator is the MD (evaluatorId), not an RA (raId)
              const isRA = req.user.role === "RA";
              await MonthlyEvaluation.create(
                {
                  employeeId: req.user.userId,
                  monthlyPlanId: existingPlan.id,
                  raId: isRA ? null : user.reportingAuthorityId,
                  evaluatorId: isRA ? user.reportingAuthorityId : null,
                  month,
                  score: 0,
                  remarks: "",
                },
                { transaction: t }
              );
            }
          }
        }

        await AuditLog.create(
          { userId: req.user.userId, action: planStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT", entityType: "MONTHLY_PLAN", entityId: String(existingPlan.id), ipAddress: req.ip },
          { transaction: t }
        );

        await t.commit();

        if (planStatus === "PENDING") {
          notifyRAOfSubmission(req.user.userId, month, "Monthly Plan");
        }

        return res.json({
          message: planStatus === "DRAFT" ? "Draft updated" : "Plan submitted",
          monthlyPlanId: existingPlan.id,
        });
      }

      // ── NEW: ADD MORE PLANS ────────────────────────────────────────────────
      // Lets an employee append extra plan items to an already-submitted
      // (PENDING) plan — e.g. the RA hands them extra work mid-month after
      // the original plan was already sent for review. Allowed only until
      // the RA/MD has evaluated this month's plan. The current-month +
      // effective-deadline gate was already enforced by
      // allowMonthlyPlanSubmission (dateMiddleware) before we got here, so
      // we don't re-check dates — we only check evaluation state and that
      // existing items are not being edited/removed.
      //
      // IMPORTANT: this deliberately does NOT bump `version`, reset the
      // MonthlyEvaluation, or touch MonthlyAchievement rows — those resets
      // belong to the REJECTED→resubmit flow above. Bumping version here
      // would also wrongly trigger the "version > 1 bypasses achievement
      // deadline checks" rule in dateMiddleware, which is meant only for
      // genuine post-rejection resubmissions.
      if (existingPlan.status === "PENDING") {
        // Lock the plan row for the rest of this transaction so two
        // concurrent "Add More Plans" submissions for the same plan can't
        // both read the same existingItems snapshot and compute the same
        // itemOrder for their new tail — the second request blocks here
        // until the first commits, then sees the first's new row(s).
        await existingPlan.reload({ transaction: t, lock: t.LOCK.UPDATE });

        const evaluation = await MonthlyEvaluation.findOne({
          where: { employeeId: req.user.userId, month },
          transaction: t,
        });
        if (evaluation && evaluation.status === "EVALUATED") {
          await t.rollback();
          return res.status(400).json({ message: "This month's plan has already been evaluated. New plans can no longer be added." });
        }

        const existingItems = await MonthlyPlanItem.findAll({
          where: { monthlyPlanId: existingPlan.id },
          order: [["itemOrder", "ASC"]],
          transaction: t,
        });

        const incoming = Array.isArray(planItems) ? planItems.filter(Boolean) : [];

        if (incoming.length <= existingItems.length) {
          await t.rollback();
          return res.status(400).json({ message: "No new plans to add." });
        }

        // The client always appends new (as-yet-unsaved) plan text at the
        // very end and never reorders the locked/already-submitted boxes it
        // rendered, so positionally slicing at existingItems.length still
        // correctly separates "what the client believes is existing" from
        // "what's genuinely new" — that part of the original design holds.
        //
        // What must NOT be position-based is verifying nothing existing was
        // edited or removed: comparing incoming[idx] === existingItems[idx]
        // one-to-one assumes the client's snapshot of existing items is in
        // the exact same order the DB has them in RIGHT NOW. That's not
        // guaranteed — repairItemOrdering() and linkAchievementItemsToPlanItems()
        // in server.js can both legitimately renumber itemOrder on a restart
        // without changing any text, and a browser that loaded this plan
        // before such a restart would then fail this check for existing
        // items it never touched. Comparing as a multiset (same texts, same
        // counts, any order) instead of position-by-position still catches
        // a real edit or removal, but is immune to reordering that changed
        // nothing about the content.
        const lockedPrefix = incoming.slice(0, existingItems.length);
        const remainingCounts = new Map();
        for (const row of existingItems) {
          remainingCounts.set(row.itemText, (remainingCounts.get(row.itemText) || 0) + 1);
        }
        let prefixUnchanged = true;
        for (const text of lockedPrefix) {
          const remaining = remainingCounts.get(text) || 0;
          if (remaining === 0) { prefixUnchanged = false; break; }
          remainingCounts.set(text, remaining - 1);
        }
        if (!prefixUnchanged) {
          await t.rollback();
          return res.status(400).json({ message: "Existing plans can't be edited or removed once submitted — you can only add new plans below them." });
        }

        const newTail = incoming.slice(existingItems.length);
        const addedAt = new Date();

        // Root-cause fix: the tail's itemOrder must start strictly after the
        // HIGHEST itemOrder already in the table, not after the existing
        // ROW COUNT. Those are only the same number when itemOrder happens
        // to be a perfectly gapless 0..n-1 sequence — true in the common
        // case, but not guaranteed (a prior race, a partial historical
        // state, etc.), and when it's not, count-based numbering assigns
        // the new tail an itemOrder LOWER than existing rows, which sorts
        // it first instead of last and silently breaks
        // MonthlyAchievementItem's positional (planIndex) linkage to it.
        const nextItemOrder = existingItems.length > 0
          ? Math.max(...existingItems.map(row => row.itemOrder)) + 1
          : 0;

        await MonthlyPlanItem.bulkCreate(
          newTail.map((text, i) => ({
            monthlyPlanId: existingPlan.id,
            itemText: text,
            itemOrder: nextItemOrder + i,
            // Marks these rows as a post-submission addition (as opposed to
            // part of the employee's original monthly plan) so the RA/MD
            // views can visually distinguish them and explain any progress
            // gap — see getMonthlyEvaluationById / getEmployeeDetail, which
            // already return these columns since they select full rows.
            addedVia: "ADD_MORE",
            addedAt,
          })),
          { transaction: t }
        );

        // Keep the legacy concatenated text field in sync. version, status,
        // and submittedAt are deliberately left untouched.
        existingPlan.planDetails = incoming.join("\n");
        await existingPlan.save({ transaction: t });

        await AuditLog.create(
          { userId: req.user.userId, action: "ADD_PLAN_ITEMS", entityType: "MONTHLY_PLAN", entityId: String(existingPlan.id), ipAddress: req.ip },
          { transaction: t }
        );

        await t.commit();
        notifyRAOfAddition(req.user.userId, month, "Monthly Plan", newTail.length);
        return res.json({ message: `${newTail.length} new plan${newTail.length !== 1 ? "s" : ""} added`, monthlyPlanId: existingPlan.id });
      }
      // ─────────────────────────────────────────────────────────────────────────

      await t.rollback();
      return res.status(409).json({ message: "Monthly plan already submitted for this month" });
    }

    // New plan
    // BUGFIX: explicitly set submittedAt based on planStatus instead of leaving it
    // to a model/column default — otherwise a brand-new DRAFT can be stamped with
    // "now" and the UI incorrectly displays it as submitted.
    const plan = await MonthlyPlan.create(
      {
        employeeId: req.user.userId,
        month,
        planDetails: resolvedPlanDetails,
        status: planStatus,
        submittedAt: planStatus === "PENDING" ? new Date() : null,
      },
      { transaction: t }
    );

    // CHANGE I: create planItems rows
    if (Array.isArray(planItems) && planItems.length > 0) {
      await MonthlyPlanItem.bulkCreate(
        planItems.filter(Boolean).map((text, idx) => ({
          monthlyPlanId: plan.id,
          itemText: text,
          itemOrder: idx,
          addedVia: "INITIAL_SUBMISSION",
          addedAt: new Date(),
        })),
        { transaction: t }
      );
    }

    if (planStatus === "PENDING") {
      const user = await User.findByPk(req.user.userId, { transaction: t });
      if (user?.reportingAuthorityId) {
        const existingEval = await MonthlyEvaluation.findOne({
          where: { employeeId: req.user.userId, month },
          transaction: t,
        });
        if (!existingEval) {
          // If the submitter is an RA, their evaluator is the MD (evaluatorId), not an RA (raId)
          const isRA = req.user.role === "RA";
          await MonthlyEvaluation.create(
            {
              employeeId: req.user.userId,
              monthlyPlanId: plan.id,
              raId: isRA ? null : user.reportingAuthorityId,
              evaluatorId: isRA ? user.reportingAuthorityId : null,
              month,
              score: 0,
              remarks: "",
            },
            { transaction: t }
          );
        }
      }
    }

    await AuditLog.create(
      { userId: req.user.userId, action: planStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT", entityType: "MONTHLY_PLAN", entityId: String(plan.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    if (planStatus === "PENDING") {
      notifyRAOfSubmission(req.user.userId, month, "Monthly Plan");
    }

    res.status(201).json({
      message: planStatus === "DRAFT" ? "Draft saved" : "Monthly plan submitted",
      monthlyPlanId: plan.id,
    });
  } catch (error) {
    await t.rollback();
    console.error("Submit Plan Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUBMIT MONTHLY ACHIEVEMENT
//    CHANGE J: planAchievements embedded array → MonthlyAchievementItem rows
//    CHANGE: pre-save hook (achievementDetails rebuild) → done inline here
// ─────────────────────────────────────────────────────────────────────────────
exports.submitMonthlyAchievement = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { monthlyPlanId, achievementDetails, planAchievements, additionalAchievement, status } = req.body;
    const achStatus = status === "DRAFT" ? "DRAFT" : "SUBMITTED";

    // CHANGE: findOne({ _id, employeeId }) → findOne({ where: { id, employeeId } })
    const plan = await MonthlyPlan.findOne({
      where: { id: monthlyPlanId, employeeId: req.user.userId },
      transaction: t,
    });

    if (!plan) {
      await t.rollback();
      return res.status(404).json({ message: "Monthly plan not found for this employee" });
    }
    if (plan.status === "DRAFT") {
      await t.rollback();
      return res.status(400).json({ message: "You must submit your monthly plan before adding an achievement." });
    }
    if (plan.status === "REJECTED") {
      await t.rollback();
      return res.status(400).json({ message: "Your monthly plan was rejected. Please resubmit the plan before adding an achievement." });
    }

    // CHANGE: Rebuild achievementDetails from planAchievements (replaces pre-save hook)
    const buildAchievementDetails = (planAchs, additional) => {
      if (!planAchs?.length) return achievementDetails || "";
      const lines = planAchs.map((a, i) => `Plan ${i + 1} [${a.progress || 0}%]: ${a.achievementDetails || "—"}`);
      if (additional?.trim()) lines.push(`Additional: ${additional}`);
      return lines.join("\n");
    };

    const resolvedDetails =
      !achievementDetails || achievementDetails.trim() === ""
        ? buildAchievementDetails(planAchievements, additionalAchievement)
        : achievementDetails;

    const existingAchievement = await MonthlyAchievement.findOne({
      where: { employeeId: req.user.userId, monthlyPlanId: plan.id },
      transaction: t,
    });

    // Plan items for this plan, sorted by itemOrder — the source used to
    // resolve which real MonthlyPlanItem each incoming planAchievements
    // entry belongs to. Prefer the planItemId the client sends (validated
    // against this list, so a stale/wrong id can never attach a progress
    // entry to a plan item outside this plan); fall back to positional
    // pairing only for older clients that don't send planItemId yet — the
    // same correspondence the app has always implicitly relied on.
    const planItemRows = await MonthlyPlanItem.findAll({
      where: { monthlyPlanId: plan.id },
      order: [["itemOrder", "ASC"]],
      transaction: t,
    });
    const validPlanItemIds = new Set(planItemRows.map(r => r.id));
    const resolvePlanItemId = (entry, positionalIndex) => {
      if (entry?.planItemId && validPlanItemIds.has(entry.planItemId)) return entry.planItemId;
      return planItemRows[positionalIndex]?.id || null;
    };

    if (existingAchievement) {
      if (existingAchievement.status === "SUBMITTED") {
        // ── NEW: ADD MORE PROGRESS ─────────────────────────────────────────────
        // Mirrors the "add more plans" flow: if extra plan items were appended
        // to the plan after achievement was already submitted, the employee can
        // add progress for just the new items — but only until the RA/MD has
        // evaluated this month's plan. Existing (already-submitted) progress
        // entries cannot be edited or removed, only appended to.

        // Same reasoning as the plan-items lock above: serializes concurrent
        // "Add More Progress" submissions for the same achievement.
        await existingAchievement.reload({ transaction: t, lock: t.LOCK.UPDATE });

        const evaluation = await MonthlyEvaluation.findOne({
          where: { employeeId: req.user.userId, month: plan.month },
          transaction: t,
        });
        if (evaluation && evaluation.status === "EVALUATED") {
          await t.rollback();
          return res.status(400).json({ message: "This month's plan has already been evaluated. Progress can no longer be added or changed." });
        }

        const existingItems = await MonthlyAchievementItem.findAll({
          where: { monthlyAchievementId: existingAchievement.id },
          order: [["planIndex", "ASC"]],
          transaction: t,
        });

        const incoming = Array.isArray(planAchievements) ? planAchievements : [];

        if (incoming.length <= existingItems.length) {
          await t.rollback();
          return res.status(400).json({ message: "No new plan items to add progress for." });
        }

        // Identity-based, not sort-order-based: match each existing row to
        // its incoming counterpart by planItemId — the real FK, immune to
        // any reordering that happened between when the client loaded this
        // data and now (see the matching comment on the plan-items check
        // above; the exact same fragility applied here via planIndex before
        // planItemId existed). Falls back to planIndex only for legacy rows
        // that predate planItemId and haven't been backfilled yet.
        const incomingByPlanItemId = new Map();
        const incomingByPlanIndex = new Map();
        incoming.forEach((entry, idx) => {
          if (entry?.planItemId) incomingByPlanItemId.set(entry.planItemId, entry);
          const key = (entry?.planIndex !== undefined && entry?.planIndex !== null) ? entry.planIndex : idx;
          if (!incomingByPlanIndex.has(key)) incomingByPlanIndex.set(key, entry);
        });

        const prefixUnchanged = existingItems.every((row, idx) => {
          const match = (row.planItemId && incomingByPlanItemId.get(row.planItemId))
            || incomingByPlanIndex.get(row.planIndex)
            || incomingByPlanIndex.get(idx);
          return match
            && (match.achievementDetails || "") === (row.achievementDetails || "")
            && (match.progress || 0) === (row.progress || 0);
        });
        if (!prefixUnchanged) {
          await t.rollback();
          return res.status(400).json({ message: "Existing progress entries can't be edited once submitted — you can only add progress for newly added plan items." });
        }

        const newTail = incoming.slice(existingItems.length);

        // Same root-cause fix as MonthlyPlanItem above: next planIndex comes
        // from the current MAX(planIndex), not existingItems.length.
        const nextPlanIndex = existingItems.length > 0
          ? Math.max(...existingItems.map(row => row.planIndex)) + 1
          : 0;

        await MonthlyAchievementItem.bulkCreate(
          newTail.map((a, i) => ({
            monthlyAchievementId: existingAchievement.id,
            // Authoritative link — the whole reason this bug class existed
            // is that planIndex/array-position was the only thing tying a
            // progress entry to a plan item. planItemId now does that job
            // directly; existingItems.length + i is only used to find the
            // right positional fallback when the client omits planItemId.
            planItemId: resolvePlanItemId(a, existingItems.length + i),
            planIndex: nextPlanIndex + i,
            achievementDetails: a.achievementDetails || "",
            progress: a.progress || 0,
            // Same origin-tracking as MonthlyPlanItem: this progress entry
            // was appended after the achievement was already SUBMITTED.
            addedVia: "ADD_MORE",
            addedAt: new Date(),
          })),
          { transaction: t }
        );

        // Keep the legacy concatenated text field in sync. status and
        // submittedAt are deliberately left untouched — this is an addition,
        // not a resubmission.
        existingAchievement.achievementDetails = resolvedDetails;
        if (additionalAchievement !== undefined) existingAchievement.additionalAchievement = additionalAchievement;
        await existingAchievement.save({ transaction: t });

        await AuditLog.create(
          { userId: req.user.userId, action: "ADD_ACHIEVEMENT_ITEMS", entityType: "MONTHLY_ACHIEVEMENT", entityId: String(existingAchievement.id), ipAddress: req.ip },
          { transaction: t }
        );

        await t.commit();
        notifyRAOfAddition(req.user.userId, plan.month, "Monthly Achievement", newTail.length);
        return res.json({ message: `${newTail.length} new progress item${newTail.length !== 1 ? "s" : ""} added` });
      }
      // ─────────────────────────────────────────────────────────────────────────

      existingAchievement.achievementDetails = resolvedDetails;
      if (additionalAchievement !== undefined) existingAchievement.additionalAchievement = additionalAchievement;
      existingAchievement.status = achStatus;
      if (achStatus === "SUBMITTED") existingAchievement.submittedAt = new Date();
      await existingAchievement.save({ transaction: t });

      // CHANGE J: replace planAchievements rows
      if (planAchievements !== undefined) {
        await MonthlyAchievementItem.destroy({
          where: { monthlyAchievementId: existingAchievement.id },
          transaction: t,
        });
        if (Array.isArray(planAchievements) && planAchievements.length > 0) {
          await MonthlyAchievementItem.bulkCreate(
            planAchievements.map((a, idx) => ({
              monthlyAchievementId: existingAchievement.id,
              planItemId: resolvePlanItemId(a, idx),
              planIndex: a.planIndex ?? idx,
              achievementDetails: a.achievementDetails || "",
              progress: a.progress || 0,
              // Full replace (draft save / non-append resubmit) — every
              // row here is treated as part of the current, original set.
              addedVia: "INITIAL_SUBMISSION",
              addedAt: new Date(),
            })),
            { transaction: t }
          );
        }
      }

      await AuditLog.create(
        { userId: req.user.userId, action: achStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT", entityType: "MONTHLY_ACHIEVEMENT", entityId: String(existingAchievement.id), ipAddress: req.ip },
        { transaction: t }
      );

      await t.commit();
      if (achStatus === "SUBMITTED") {
        notifyRAOfSubmission(req.user.userId, plan.month, "Monthly Achievement");
      }
      return res.json({ message: achStatus === "DRAFT" ? "Draft saved" : "Achievement submitted" });
    }

    // New achievement
    const achievement = await MonthlyAchievement.create(
      {
        employeeId: req.user.userId,
        monthlyPlanId,
        achievementDetails: resolvedDetails,
        additionalAchievement: additionalAchievement || "",
        status: achStatus,
      },
      { transaction: t }
    );

    // CHANGE J: create planAchievements rows
    if (Array.isArray(planAchievements) && planAchievements.length > 0) {
      await MonthlyAchievementItem.bulkCreate(
        planAchievements.map((a, idx) => ({
          monthlyAchievementId: achievement.id,
          planItemId: resolvePlanItemId(a, idx),
          planIndex: a.planIndex ?? idx,
          achievementDetails: a.achievementDetails || "",
          progress: a.progress || 0,
          addedVia: "INITIAL_SUBMISSION",
          addedAt: new Date(),
        })),
        { transaction: t }
      );
    }

    await AuditLog.create(
      { userId: req.user.userId, action: achStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT", entityType: "MONTHLY_ACHIEVEMENT", entityId: String(achievement.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    if (achStatus === "SUBMITTED") {
      notifyRAOfSubmission(req.user.userId, plan.month, "Monthly Achievement");
    }
    res.status(201).json({ message: achStatus === "DRAFT" ? "Draft saved" : "Monthly achievement submitted" });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. SUBMIT YEARLY PLAN
//    CHANGE K: kras embedded array → YearlyPlanKra rows in a transaction
// ─────────────────────────────────────────────────────────────────────────────
exports.submitYearlyPlan = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { financialYear, kras, status } = req.body;
    const planStatus = status === "DRAFT" ? "DRAFT" : "PENDING";

    if (!financialYear) {
      await t.rollback();
      return res.status(400).json({ message: "financialYear is required." });
    }
    if (planStatus === "PENDING") {
      if (!Array.isArray(kras) || kras.length === 0) {
        await t.rollback();
        return res.status(400).json({ message: "At least one KRA is required to submit a yearly plan." });
      }
      for (const kra of kras) {
        if (!kra.description?.trim() || !kra.target?.trim() || !kra.timeline?.trim()) {
          await t.rollback();
          return res.status(400).json({ message: "Each KRA must have a description, target, and timeline." });
        }
      }
    }

    const existingPlan = await YearlyPlan.findOne({
      where: { employeeId: req.user.userId, financialYear },
      transaction: t,
    });

    if (existingPlan) {
      if (existingPlan.status === "DRAFT") {
        existingPlan.status = planStatus;
        if (planStatus === "PENDING") existingPlan.submittedAt = new Date();
        await existingPlan.save({ transaction: t });

        // CHANGE K: replace kras rows
        if (Array.isArray(kras) && kras.length > 0) {
          await YearlyPlanKra.destroy({ where: { yearlyPlanId: existingPlan.id }, transaction: t });
          await YearlyPlanKra.bulkCreate(
            kras.map((k, idx) => ({ yearlyPlanId: existingPlan.id, kraIndex: idx, description: k.description, target: k.target, timeline: k.timeline })),
            { transaction: t }
          );
        }

        await AuditLog.create(
          { userId: req.user.userId, action: planStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT", entityType: "YEARLY_PLAN", entityId: String(existingPlan.id), ipAddress: req.ip },
          { transaction: t }
        );

        await t.commit();
        return res.json({ message: planStatus === "DRAFT" ? "Draft updated" : "Yearly plan submitted for review", planId: existingPlan.id });
      }

      await t.rollback();
      return res.status(409).json({ message: "A yearly plan already exists for this financial year." });
    }

    const plan = await YearlyPlan.create(
      { employeeId: req.user.userId, financialYear, status: planStatus, version: 1, submittedAt: planStatus === "PENDING" ? new Date() : null },
      { transaction: t }
    );

    // CHANGE K: create kras rows
    if (Array.isArray(kras) && kras.length > 0) {
      await YearlyPlanKra.bulkCreate(
        kras.map((k, idx) => ({ yearlyPlanId: plan.id, kraIndex: idx, description: k.description, target: k.target, timeline: k.timeline })),
        { transaction: t }
      );
    }

    await AuditLog.create(
      { userId: req.user.userId, action: planStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT", entityType: "YEARLY_PLAN", entityId: String(plan.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    res.status(201).json({ message: planStatus === "DRAFT" ? "Draft saved" : "Yearly plan submitted successfully", planId: plan.id });
  } catch (error) {
    await t.rollback();
    console.error("Submit Yearly Plan Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3b. EDIT YEARLY PLAN
//     CHANGE K: kras → YearlyPlanKra rows
// ─────────────────────────────────────────────────────────────────────────────
exports.editYearlyPlan = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { kras, status } = req.body;
    const targetStatus = status === "PENDING" ? "PENDING" : "DRAFT";

    // CHANGE: findOne({ _id: id, employeeId }) → findOne({ where: { id, employeeId } })
    const plan = await YearlyPlan.findOne({
      where: { id, employeeId: req.user.userId },
      transaction: t,
    });

    if (!plan) { await t.rollback(); return res.status(404).json({ message: "Yearly plan not found" }); }
    if (plan.status !== "DRAFT") { await t.rollback(); return res.status(400).json({ message: "Only DRAFT plans can be edited." }); }

    if (targetStatus === "PENDING") {
      if (!Array.isArray(kras) || kras.length === 0) { await t.rollback(); return res.status(400).json({ message: "At least one KRA is required to submit." }); }
      for (const kra of kras) {
        if (!kra.description?.trim() || !kra.target?.trim() || !kra.timeline?.trim()) {
          await t.rollback(); return res.status(400).json({ message: "Each KRA must have a description, target, and timeline." });
        }
      }
    }

    plan.status = targetStatus;
    if (targetStatus === "PENDING") plan.submittedAt = new Date();
    await plan.save({ transaction: t });

    if (Array.isArray(kras) && kras.length > 0) {
      await YearlyPlanKra.destroy({ where: { yearlyPlanId: plan.id }, transaction: t });
      await YearlyPlanKra.bulkCreate(
        kras.map((k, idx) => ({ yearlyPlanId: plan.id, kraIndex: idx, description: k.description, target: k.target, timeline: k.timeline })),
        { transaction: t }
      );
    }

    await AuditLog.create(
      { userId: req.user.userId, action: targetStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT", entityType: "YEARLY_PLAN", entityId: String(plan.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    res.json({ message: targetStatus === "DRAFT" ? "Draft saved" : "Yearly plan submitted for review" });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3c. RESUBMIT YEARLY PLAN
//     CHANGE K: kras → YearlyPlanKra rows
//     CHANGE L: revisionLog.push({}) → YearlyPlanRevisionLog.create({})
// ─────────────────────────────────────────────────────────────────────────────
exports.resubmitYearlyPlan = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { kras, revisionReason } = req.body;

    if (!Array.isArray(kras) || kras.length === 0) { await t.rollback(); return res.status(400).json({ message: "At least one KRA is required for resubmission." }); }
    for (const kra of kras) {
      if (!kra.description?.trim() || !kra.target?.trim() || !kra.timeline?.trim()) {
        await t.rollback(); return res.status(400).json({ message: "Each KRA must have a description, target, and timeline." });
      }
    }
    if (!revisionReason?.trim()) { await t.rollback(); return res.status(400).json({ message: "Reason for revision is required for resubmission." }); }

    const plan = await YearlyPlan.findOne({ where: { id, employeeId: req.user.userId }, transaction: t });
    if (!plan) { await t.rollback(); return res.status(404).json({ message: "Yearly plan not found" }); }
    if (plan.status !== "REJECTED") { await t.rollback(); return res.status(400).json({ message: "Only REJECTED plans can be resubmitted." }); }

    const newVersion = (plan.version || 1) + 1;

    // CHANGE L: instead of plan.revisionLog.push({...}), create a separate DB row
    await YearlyPlanRevisionLog.create(
      { yearlyPlanId: plan.id, version: newVersion, revisedAt: new Date(), reason: revisionReason.trim() },
      { transaction: t }
    );

    // CHANGE K: replace kras rows
    await YearlyPlanKra.destroy({ where: { yearlyPlanId: plan.id }, transaction: t });
    await YearlyPlanKra.bulkCreate(
      kras.map((k, idx) => ({ yearlyPlanId: plan.id, kraIndex: idx, description: k.description, target: k.target, timeline: k.timeline })),
      { transaction: t }
    );

    plan.status = "PENDING";
    plan.mdRemarks = null;
    plan.version = newVersion;
    plan.submittedAt = new Date();
    await plan.save({ transaction: t });

    await AuditLog.create(
      { userId: req.user.userId, action: "RESUBMIT", entityType: "YEARLY_PLAN", entityId: String(plan.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    res.json({ message: "Yearly plan resubmitted successfully", planId: plan.id });
  } catch (error) {
    await t.rollback();
    console.error("Resubmit Yearly Plan Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET MONTHLY PLANS
//    CHANGE: find(filter) → findAll({ where, include, order })
//    CHANGE: .populate('employeeId', ...) → include: [{ model: User, as: 'employee' }]
// ─────────────────────────────────────────────────────────────────────────────
exports.getMonthlyPlans = async (req, res) => {
  try {
    const where = {};
    // EMPLOYEE and RA (self-view): scope to own records unless a specific employeeId is requested
    if (req.user.role === "EMPLOYEE") where.employeeId = req.user.userId;
    if (req.user.role === "RA" && !req.query.employeeId) where.employeeId = req.user.userId;
    if (req.query.month) where.month = req.query.month;
    if (req.query.employeeId && !["EMPLOYEE"].includes(req.user.role)) where.employeeId = req.query.employeeId;

    const plans = await MonthlyPlan.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        // NOTE: Sequelize v6 silently ignores `order` inside a nested `include`
        // (identical gotcha to the one already documented in
        // getMonthlyAchievements below). Leaving an order clause here gave the
        // false impression planItems came back sorted — they didn't, which is
        // why a plan item appended via "Add More Plans" could render (and,
        // downstream, get achievement-matched) at the wrong position instead
        // of at the tail. Ordering is applied in JS after the query instead.
        { model: MonthlyPlanItem, as: "planItems" },
      ],
      order: [["submittedAt", "DESC"]],
    });

    // Sort planItems by itemOrder (0-based) so the frontend always receives
    // items in the correct plan order regardless of DB insertion/JOIN order —
    // mirrors the planAchievements sort in getMonthlyAchievements below.
    plans.forEach((plan) => {
      if (Array.isArray(plan.planItems)) {
        plan.planItems.sort((a, b) => (a.itemOrder ?? 0) - (b.itemOrder ?? 0));
      }
    });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly plans" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET MONTHLY ACHIEVEMENTS
// ─────────────────────────────────────────────────────────────────────────────
exports.getMonthlyAchievements = async (req, res) => {
  try {
    const where = {};
    if (req.user.role === "EMPLOYEE") where.employeeId = req.user.userId;
    if (req.user.role === "RA" && !req.query.employeeId) where.employeeId = req.user.userId;
    if (req.query.monthlyPlanId) where.monthlyPlanId = req.query.monthlyPlanId;
    if (req.query.employeeId && req.user.role !== "EMPLOYEE") where.employeeId = req.query.employeeId;

    const achievements = await MonthlyAchievement.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "month", "planDetails"] },
        // NOTE: Sequelize v6 silently ignores `order` inside a nested `include`.
        // Ordering is applied in JS after the query (see sort below).
        { model: MonthlyAchievementItem, as: "planAchievements" },
      ],
      order: [["submittedAt", "DESC"]],
    });

    // Sort planAchievements by planIndex (0-based) so the frontend always
    // receives items in the correct plan order regardless of DB insertion order.
    achievements.forEach((ach) => {
      if (Array.isArray(ach.planAchievements)) {
        ach.planAchievements.sort((a, b) => (a.planIndex ?? 0) - (b.planIndex ?? 0));
      }
    });

    res.json(achievements);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly achievements" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET YEARLY PLANS
// ─────────────────────────────────────────────────────────────────────────────
exports.getYearlyPlans = async (req, res) => {
  try {
    const where = {};
    if (req.user.role === "EMPLOYEE") where.employeeId = req.user.userId;
    if (req.user.role === "RA" && !req.query.employeeId) where.employeeId = req.user.userId;
    if (req.query.financialYear) where.financialYear = req.query.financialYear;
    if (req.query.employeeId && req.user.role !== "EMPLOYEE") where.employeeId = req.query.employeeId;

    const plans = await YearlyPlan.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] },
      ],
      order: [["submittedAt", "DESC"]],
    });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch yearly plans" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET APPROVED YEARLY PLANS
//    CHANGE: .select('...') → attributes: [...]
//    CHANGE: kras embedded → included via YearlyPlanKra
// ─────────────────────────────────────────────────────────────────────────────
exports.getApprovedYearlyPlans = async (req, res) => {
  try {
    const where = { employeeId: req.user.userId, status: "APPROVED" };
    if (req.query.financialYear) where.financialYear = req.query.financialYear;

    const plans = await YearlyPlan.findAll({
      where,
      attributes: ["id", "financialYear", "version", "status", "submittedAt"],
      include: [{ model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] }],
      order: [["version", "DESC"]],
    });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch approved yearly plans" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT YEARLY APPRAISAL REPORT
//    CHANGE M: kraAssessments embedded array → YearlyAppraisalKraAssessment rows
// ─────────────────────────────────────────────────────────────────────────────
exports.submitYearlyAppraisalReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { linkedYearlyPlan, financialYear, kraAssessments, additionalAssignments, status } = req.body;
    const reportStatus = status === "DRAFT" ? "DRAFT" : "SUBMITTED";

    if (!financialYear) { await t.rollback(); return res.status(400).json({ message: "financialYear is required." }); }

    if (reportStatus === "SUBMITTED") {
      if (!Array.isArray(kraAssessments) || kraAssessments.length === 0) {
        await t.rollback(); return res.status(400).json({ message: "kraAssessments is required with at least one entry." });
      }
      for (let i = 0; i < kraAssessments.length; i++) {
        if (!kraAssessments[i].achievement?.trim()) {
          await t.rollback(); return res.status(400).json({ message: `Achievement text is missing for KRA ${i + 1}.` });
        }
      }
    } else {
      const hasAtLeastOne = Array.isArray(kraAssessments) && kraAssessments.some(k => k.achievement?.trim());
      if (!hasAtLeastOne && !additionalAssignments?.trim()) {
        await t.rollback(); return res.status(400).json({ message: "Please write at least one achievement before saving as draft." });
      }
    }

    const existing = await YearlyAppraisalReport.findOne({
      where: { employeeId: req.user.userId, financialYear },
      transaction: t,
    });

    if (existing) {
      if (existing.status === "DRAFT") {
        if (Array.isArray(kraAssessments)) {
          // CHANGE M: replace kraAssessment rows
          await YearlyAppraisalKraAssessment.destroy({ where: { yearlyAppraisalReportId: existing.id }, transaction: t });
          await YearlyAppraisalKraAssessment.bulkCreate(
            kraAssessments.map((k, idx) => ({ yearlyAppraisalReportId: existing.id, kraIndex: k.kraIndex ?? idx, description: k.description || "", target: k.target || "", timeline: k.timeline || "", achievement: k.achievement || "" })),
            { transaction: t }
          );
        }
        if (additionalAssignments !== undefined) existing.additionalAssignments = additionalAssignments || null;
        if (reportStatus === "SUBMITTED") { existing.status = "SUBMITTED"; existing.submittedAt = new Date(); }
        await existing.save({ transaction: t });

        await AuditLog.create(
          { userId: req.user.userId, action: reportStatus === "SUBMITTED" ? "SUBMIT" : "DRAFT_UPDATE", entityType: "YEARLY_APPRAISAL_REPORT", entityId: String(existing.id), ipAddress: req.ip },
          { transaction: t }
        );

        await t.commit();
        return res.json({ message: reportStatus === "SUBMITTED" ? "Yearly appraisal report submitted successfully." : "Draft updated.", reportId: existing.id });
      }

      await t.rollback();
      return res.status(409).json({ message: "A yearly appraisal report has already been submitted for this financial year." });
    }

    const report = await YearlyAppraisalReport.create(
      { employeeId: req.user.userId, linkedYearlyPlanId: linkedYearlyPlan || null, financialYear, additionalAssignments: additionalAssignments || null, status: reportStatus, submittedAt: reportStatus === "SUBMITTED" ? new Date() : null },
      { transaction: t }
    );

    // CHANGE M: create kraAssessment rows
    if (Array.isArray(kraAssessments) && kraAssessments.length > 0) {
      await YearlyAppraisalKraAssessment.bulkCreate(
        kraAssessments.map((k, idx) => ({ yearlyAppraisalReportId: report.id, kraIndex: k.kraIndex ?? idx, description: k.description || "", target: k.target || "", timeline: k.timeline || "", achievement: k.achievement || "" })),
        { transaction: t }
      );
    }

    await AuditLog.create(
      { userId: req.user.userId, action: reportStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT", entityType: "YEARLY_APPRAISAL_REPORT", entityId: String(report.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    res.status(201).json({ message: reportStatus === "DRAFT" ? "Appraisal report draft saved." : "Yearly appraisal report submitted successfully.", reportId: report.id });
  } catch (error) {
    await t.rollback();
    console.error("Submit Yearly Appraisal Report Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE YEARLY APPRAISAL REPORT  (PUT /:id)
//    CHANGE M: kraAssessments → YearlyAppraisalKraAssessment rows
// ─────────────────────────────────────────────────────────────────────────────
exports.updateYearlyAppraisalReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { kraAssessments, additionalAssignments, status } = req.body;

    const report = await YearlyAppraisalReport.findOne({
      where: { id, employeeId: req.user.userId },
      transaction: t,
    });

    if (!report) { await t.rollback(); return res.status(404).json({ message: "Appraisal report not found." }); }
    if (report.status !== "DRAFT") { await t.rollback(); return res.status(400).json({ message: "Only DRAFT appraisal reports can be edited." }); }

    const targetStatus = status === "SUBMITTED" ? "SUBMITTED" : "DRAFT";

    if (targetStatus === "SUBMITTED") {
      if (!Array.isArray(kraAssessments) || kraAssessments.length === 0) { await t.rollback(); return res.status(400).json({ message: "kraAssessments must contain at least one entry." }); }
      for (let i = 0; i < kraAssessments.length; i++) {
        if (!kraAssessments[i].achievement?.trim()) { await t.rollback(); return res.status(400).json({ message: `Achievement text is missing for KRA ${i + 1}.` }); }
      }
    } else {
      const hasAtLeastOne = Array.isArray(kraAssessments) && kraAssessments.some(k => k.achievement?.trim());
      if (!hasAtLeastOne && !additionalAssignments?.trim()) { await t.rollback(); return res.status(400).json({ message: "Please write at least one achievement or progress entry before saving as draft." }); }
    }

    // CHANGE M: replace kraAssessment rows
    if (Array.isArray(kraAssessments)) {
      await YearlyAppraisalKraAssessment.destroy({ where: { yearlyAppraisalReportId: report.id }, transaction: t });
      await YearlyAppraisalKraAssessment.bulkCreate(
        kraAssessments.map((k, idx) => ({ yearlyAppraisalReportId: report.id, kraIndex: k.kraIndex ?? idx, description: k.description || "", target: k.target || "", timeline: k.timeline || "", achievement: k.achievement || "" })),
        { transaction: t }
      );
    }

    if (additionalAssignments !== undefined) report.additionalAssignments = additionalAssignments || null;
    report.status = targetStatus;
    if (targetStatus === "SUBMITTED") report.submittedAt = new Date();
    await report.save({ transaction: t });

    await AuditLog.create(
      { userId: req.user.userId, action: targetStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT", entityType: "YEARLY_APPRAISAL_REPORT", entityId: String(report.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
    res.json({ message: targetStatus === "DRAFT" ? "Draft saved." : "Yearly appraisal report submitted successfully.", reportId: report.id });
  } catch (error) {
    await t.rollback();
    console.error("Update Yearly Appraisal Report Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET YEARLY APPRAISAL REPORTS
//    CHANGE: populate → include (with nested includes for kraAssessments, kras)
// ─────────────────────────────────────────────────────────────────────────────
exports.getYearlyAppraisalReports = async (req, res) => {
  try {
    const where = {};
    if (req.user.role === "EMPLOYEE") where.employeeId = req.user.userId;
    if (req.user.role === "RA" && !req.query.employeeId) where.employeeId = req.user.userId;
    if (req.query.financialYear) where.financialYear = req.query.financialYear;
    if (req.query.employeeId && req.user.role !== "EMPLOYEE") where.employeeId = req.query.employeeId;

    const reports = await YearlyAppraisalReport.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        {
          model: YearlyPlan,
          as: "linkedYearlyPlan",
          attributes: ["id", "financialYear", "version", "status", "submittedAt"],
          include: [{ model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] }],
        },
        { model: YearlyAppraisalKraAssessment, as: "kraAssessments", order: [["kraIndex", "ASC"]] },
      ],
      order: [["submittedAt", "DESC"]],
    });

    // Employees only see their own fields, not RA/HRD/MD scores
    if (req.user.role === "EMPLOYEE") {
      const filtered = reports.map(r => ({
        id: r.id,
        financialYear: r.financialYear,
        kraAssessments: r.kraAssessments || [],
        additionalAssignments: r.additionalAssignments,
        status: r.status,
        submittedAt: r.submittedAt,
        updatedAt: r.updatedAt,
        raRemarks: r.raRemarks || null,
        hrdRemarks: r.hrdRemarks || null,
        mdRemarks: r.mdRemarks || null,
        linkedYearlyPlan: r.linkedYearlyPlan || null,
      }));
      return res.json(filtered);
    }

    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch yearly appraisal reports" });
  }
};

/* ─── GET MY DEADLINE CONTEXT ───────────────────────────────────────────────────
   GET /api/employee/my-deadline-context
   Query params: month (1-12), year, type (PLAN|ACHIEVEMENT)

   Employee-facing counterpart of the RA's GET /ra/extend-deadline/context.
   Always scoped to req.user.userId so any authenticated employee (or RA in
   employee-mode) can check their OWN effective deadline without RA credentials.

   Returns:
     { type, month, year, baseDeadline, effectiveDeadline,
       isExtended, extensionCount, maxDate, minDate }
────────────────────────────────────────────────────────────────── */
exports.getMyDeadlineContext = async (req, res) => {
  try {
    const employeeId = req.user.userId;
    const { month, year, type } = req.query;

    if (!month || !year || !type) {
      return res.status(400).json({ message: "month, year, and type are required." });
    }

    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    const typeUpper = type.toUpperCase();

    if (!["PLAN", "ACHIEVEMENT"].includes(typeUpper)) {
      return res.status(400).json({ message: "type must be PLAN or ACHIEVEMENT" });
    }
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ message: "month must be 1-12" });
    }
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ message: "year is invalid" });
    }

    const empRole = normalizeRole(req.user.role);
    const config = parseDeadlineConfig(empRole);

    // Compute base deadline for this type
    const baseDeadline = typeUpper === "PLAN"
      ? buildDeadlineDate(yearNum, monthNum, config.planDay, 0, true)
      : buildDeadlineDate(yearNum, monthNum, config.achievementDay, config.achievementDeadlineMonthOffset, true);

    // Check for an RA-granted extension
    const { effectiveDeadline, isExtended, extensionCount, lastExtension } = await getEffectiveDeadline({
      employeeId,
      month: monthNum,
      year: yearNum,
      type: typeUpper,
      baseDeadline,
    });

    // Ceiling (used by the frontend date-picker if ever shown)
    const ceiling = getExtensionCeiling(empRole, typeUpper, monthNum, yearNum);
    const now = new Date();
    const monthStr = `${yearNum}-${String(monthNum).padStart(2, "0")}`;

    res.json({
      type: typeUpper,
      month: monthStr,
      year: yearNum,
      baseDeadline: baseDeadline.toISOString().split("T")[0],
      effectiveDeadline: effectiveDeadline.toISOString().split("T")[0],
      isExtended,
      extensionCount,
      isWithinDeadline: now <= effectiveDeadline,
      minDate: now.toISOString().split("T")[0],
      maxDate: ceiling.toISOString().split("T")[0],
      // DASHBOARD EXTENSION TRANSPARENCY — surfaces the RA's stated reason and
      // when the extension was granted, so the employee-facing dashboard can
      // render a tooltip without a second, RA-only endpoint call. lastExtension
      // is already fetched by getEffectiveDeadline() above — no extra query.
      reason: isExtended && lastExtension ? lastExtension.reason : null,
      extendedAt: isExtended && lastExtension ? lastExtension.createdAt : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load deadline context", error: error.message });
  }
};