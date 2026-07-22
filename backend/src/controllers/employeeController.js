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
            planItems.filter(Boolean).map((text, idx) => ({ monthlyPlanId: existingPlan.id, itemText: text, itemOrder: idx })),
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
        return res.json({
          message: planStatus === "DRAFT" ? "Draft updated" : "Plan submitted",
          monthlyPlanId: existingPlan.id,
        });
      }

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
        planItems.filter(Boolean).map((text, idx) => ({ monthlyPlanId: plan.id, itemText: text, itemOrder: idx })),
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

    if (existingAchievement) {
      if (existingAchievement.status === "SUBMITTED") {
        await t.rollback();
        return res.status(409).json({ message: "Monthly achievement already submitted for this month" });
      }

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
              planIndex: a.planIndex ?? idx,
              achievementDetails: a.achievementDetails || "",
              progress: a.progress || 0,
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
          planIndex: a.planIndex ?? idx,
          achievementDetails: a.achievementDetails || "",
          progress: a.progress || 0,
        })),
        { transaction: t }
      );
    }

    await AuditLog.create(
      { userId: req.user.userId, action: achStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT", entityType: "MONTHLY_ACHIEVEMENT", entityId: String(achievement.id), ipAddress: req.ip },
      { transaction: t }
    );

    await t.commit();
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
        { model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] },
      ],
      order: [["submittedAt", "DESC"]],
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
        { model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] },
      ],
      order: [["submittedAt", "DESC"]],
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