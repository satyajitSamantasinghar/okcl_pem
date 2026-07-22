// ─────────────────────────────────────────────────────────────────────────────
//  MD CONTROLLER  —  Mongoose → Sequelize conversion
//
//  KEY CHANGES:
//  1. countDocuments(filter)    → Model.count({ where: filter })
//  2. findById(id)              → findByPk(id)
//  3. find(filter)              → findAll({ where, include, order })
//  4. populate()                → include: [{ model, as, attributes }]
//  5. $in / $or / $gte / $lte  → Op.in / Op.or / Op.gte / Op.lte
//  6. regex search              → Op.iLike  (PostgreSQL)
//  7. $regex: `^${year}`        → Op.like: `${year}%`
//  8. N+1 per-plan queries      → batch queries + in-memory Maps (same as hrdController fix)
//  9. _id                       → id
//  10. entityId stored as String (no polymorphic FK in PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────────

const {
  sequelize,
  User,
  MonthlyPlan,
  MonthlyPlanItem,
  MonthlyAchievement,
  MonthlyAchievementItem,
  MonthlyEvaluation,
  QuarterlyEvaluation,
  YearlyPlan,
  YearlyPlanKra,
  YearlyPlanRevisionLog,
  YearlyAppraisalReport,
  YearlyAppraisalKraAssessment,
  AuditLog,
} = require("../models");

const { Op } = require("sequelize");
const { getCurrentFiscalYear } = require("../utils/fiscalUtils");

/* ─── MD DASHBOARD ───────────────────────────────────────────────────────────── */
exports.getMDDashboard = async (req, res) => {
  try {
    const month = req.query.month || (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    })();

    const fy = getCurrentFiscalYear();

    // CHANGE 1: countDocuments → Model.count({ where })
    const [
      totalEmployees,
      totalRAs,
      monthlyPlansSubmitted,
      yearlyPlansTotal,
      yearlyPlansPending,
      yearlyReportsTotal,
      todayAuditCount,
    ] = await Promise.all([
      User.count({ where: { role: { [Op.in]: ["EMPLOYEE", "RA"] } } }), // RAs are also employees
      User.count({ where: { role: "RA" } }),
      MonthlyPlan.count({ where: { month } }),
      YearlyPlan.count({ where: { financialYear: fy } }),
      YearlyPlan.count({ where: { financialYear: fy, status: "PENDING" } }),
      YearlyAppraisalReport.count({ where: { financialYear: fy } }),
      // CHANGE 5: { $gte: new Date(...) } → Op.gte
      AuditLog.count({
        where: { timestamp: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
    ]);

    // CHANGE 8: replaced the awkward chained .then() with a clean two-step query
    const plansThisMonth = await MonthlyPlan.findAll({ where: { month }, attributes: ["id"] });
    const planIds = plansThisMonth.map(p => p.id);
    const monthlyAchievementsSubmitted = planIds.length > 0
      ? await MonthlyAchievement.count({ where: { monthlyPlanId: { [Op.in]: planIds } } })
      : 0;

    res.json({
      totalEmployees,
      totalRAs,
      monthlyPlansSubmitted,
      monthlyPlansPending:         Math.max(0, totalEmployees - monthlyPlansSubmitted),
      monthlyAchievementsSubmitted,
      monthlyAchievementsPending:  Math.max(0, monthlyPlansSubmitted - monthlyAchievementsSubmitted),
      yearlyPlansTotal,
      yearlyPlansPending,
      yearlyReportsTotal,
      todayAuditCount,
      currentMonth: month,
      currentFY: fy,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── AUDIT LOGS ─────────────────────────────────────────────────────────────── */
exports.getAuditLogs = async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = {};

    // CHANGE 5: { $gte, $lte } → Op.gte, Op.lte
    if (req.query.from || req.query.to) {
      where.timestamp = {};
      if (req.query.from) where.timestamp[Op.gte] = new Date(req.query.from);
      if (req.query.to)   where.timestamp[Op.lte] = new Date(new Date(req.query.to).setHours(23, 59, 59, 999));
    }

    if (req.query.entityType) where.entityType = req.query.entityType;
    if (req.query.action)     where.action      = req.query.action;

    // CHANGE 4: populate("userId", ...) → include: [{ model: User, as: "user" }]
    const [logs, total] = await Promise.all([
      AuditLog.findAll({
        where,
        include: [{ model: User, as: "user", attributes: ["id", "name", "employeeCode", "role"] }],
        order:  [["timestamp", "DESC"]],
        offset,
        limit,
      }),
      AuditLog.count({ where }),
    ]);

    res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── EMPLOYEE DETAIL ────────────────────────────────────────────────────────── */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // CHANGE 2 + 4: findById → findByPk; populate → include
    const employee = await User.findByPk(id, {
      attributes: ["id", "name", "employeeCode", "department", "role", "reportingAuthorityId"],
      include: [{ model: User, as: "reportingAuthority", attributes: ["id", "name"] }],
    });

    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const [monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports] = await Promise.all([
      MonthlyPlan.findAll({
        where: { employeeId: id },
        include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }],
        order: [["month", "DESC"]],
      }),
      MonthlyAchievement.findAll({
        where: { employeeId: id },
        include: [
          { model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "month", "planDetails"] },
          { model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] },
        ],
        order: [["submittedAt", "DESC"]],
      }),
      MonthlyEvaluation.findAll({
        where: { employeeId: id },
        include: [{ model: User, as: "ra", attributes: ["id", "name"] }],
        order: [["month", "DESC"]],
      }),
      QuarterlyEvaluation.findAll({
        where: { employeeId: id },
        include: [{ model: User, as: "ra", attributes: ["id", "name"] }],
        order: [["createdAt", "DESC"]],
      }),
      // FIX: exclude DRAFT yearly plans from per-employee detail view (MD perspective).
      YearlyPlan.findAll({
        where: { employeeId: id, status: { [Op.ne]: "DRAFT" } },
        include: [{ model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] }],
        order: [["submittedAt", "DESC"]],
      }),
      // FIX: exclude DRAFT appraisal reports from per-employee detail view.
      YearlyAppraisalReport.findAll({
        where: { employeeId: id, status: { [Op.ne]: "DRAFT" } },
        include: [{ model: YearlyAppraisalKraAssessment, as: "kraAssessments" }],
        order: [["submittedAt", "DESC"]],
      }),
    ]);

    res.json({ employee, monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL EMPLOYEES LIST ─────────────────────────────────────────────────────── */
exports.getAllEmployees = async (req, res) => {
  try {
    // CHANGE 5: { role: { $in } } → Op.in
    const where = { role: { [Op.in]: ["EMPLOYEE", "RA"] } };

    if (req.query.q) {
      const q = req.query.q.trim().substring(0, 60);
      // CHANGE 6: new RegExp(q, 'i') → Op.iLike
      where[Op.or] = [
        { name:         { [Op.iLike]: `%${q}%` } },
        { employeeCode: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const employees = await User.findAll({
      where,
      attributes: ["id", "name", "employeeCode", "department", "role", "reportingAuthorityId"],
      order: [["name", "ASC"]],
      limit: req.query.q ? 50 : undefined,
    });

    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── REJECT MONTHLY PLAN (deprecated) ──────────────────────────────────────── */
exports.rejectMonthlyPlan = async (_req, res) => {
  return res.status(410).json({
    message: "Monthly plan rejection is no longer handled by MD. Use PUT /ra/monthly-plan/:id/reject instead.",
  });
};

/* ─── APPROVE / REJECT YEARLY PLAN ──────────────────────────────────────────── */
exports.approveRejectYearlyPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, mdRemarks } = req.body;

    // CHANGE 2: findById → findByPk
    const plan = await YearlyPlan.findByPk(id);
    if (!plan) return res.status(404).json({ message: "Yearly plan not found" });

    if (decision === "APPROVE")       plan.status = "APPROVED";
    else if (decision === "REJECT")   plan.status = "REJECTED";
    else return res.status(400).json({ message: "Decision must be APPROVE or REJECT" });

    plan.mdRemarks = mdRemarks || null;
    await plan.save();

    // CHANGE 10: entityId as String
    await AuditLog.create({ userId: req.user.userId, action: decision, entityType: "YEARLY_PLAN", entityId: String(plan.id), ipAddress: req.ip });
    res.json({ message: `Yearly plan ${plan.status.toLowerCase()}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── MD: EVALUATE YEARLY APPRAISAL REPORT ──────────────────────────────────── */
exports.evaluateYearlyReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { mdFinalScore, mdRemarks } = req.body;

    if (Number(mdFinalScore) > 15) return res.status(400).json({ message: "MD score cannot exceed 15" });

    const report = await YearlyAppraisalReport.findByPk(id);
    if (!report) return res.status(404).json({ message: "Yearly appraisal report not found" });

    report.mdFinalScore  = mdFinalScore;
    report.mdRemarks     = mdRemarks || null;
    report.mdEvaluatedAt = new Date();
    report.grandTotal    = (report.raTotalScore || 0) + (report.hrdTotalScore || 0) + (Number(mdFinalScore) || 0);
    report.status        = "COMPLETED";
    await report.save();

    await AuditLog.create({ userId: req.user.userId, action: "MD_EVALUATE", entityType: "YEARLY_APPRAISAL_REPORT", entityId: String(report.id), ipAddress: req.ip });
    res.json({ message: "MD evaluation submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL MONTHLY PLANS (MD view) ───────────────────────────────────────────── */
// CHANGE 8: original code had N+1 per-plan queries; replaced with batch + Maps
exports.getMonthlyPlansList = async (req, res) => {
  try {
    const { month, year, status } = req.query;

    // FIX: exclude DRAFT monthly plans by default — MD should only see plans
    // the employee has actually submitted (PENDING / APPROVED / REJECTED).
    // If the caller explicitly passes ?status=..., that overrides this default.
    const where = { status: { [Op.ne]: "DRAFT" } };

    if (month) {
      where.month = month;
    } else if (year) {
      // CHANGE 7: { $regex: `^${year}` } → Op.like
      where.month = { [Op.like]: `${year}%` };
    }
    // Only override the default DRAFT exclusion if a specific status is requested
    if (status) where.status = status;

    const plans = await MonthlyPlan.findAll({
      where,
      include: [
        {
          model: User, as: "employee", required: true,
          attributes: ["id", "name", "employeeCode", "department", "role"],
          // ── Bug fix: exclude RA role — RA self-submissions go to the RA Plans tab ──
          where: { role: "EMPLOYEE" },
        },
        { model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] },
      ],
      order: [["month", "DESC"], ["submittedAt", "DESC"]],
      limit: 200,
    });

    if (plans.length === 0) return res.json([]);

    const planIds     = plans.map(p => p.id);
    const employeeIds = [...new Set(plans.map(p => p.employeeId))];
    const months      = [...new Set(plans.map(p => p.month))];

    const [evaluations, achievements] = await Promise.all([
      MonthlyEvaluation.findAll({
        where: { employeeId: { [Op.in]: employeeIds }, month: { [Op.in]: months } },
        attributes: ["employeeId", "month", "status", "score", "remarks", "evaluatedAt"],
      }),
      MonthlyAchievement.findAll({
        where: { monthlyPlanId: { [Op.in]: planIds } },
        include: [{ model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] }],
      }),
    ]);

    const evalMap = {};
    evaluations.forEach(ev => { evalMap[`${ev.employeeId}__${ev.month}`] = ev; });
    const achMap = {};
    achievements.forEach(ach => { achMap[ach.monthlyPlanId] = ach; });

    const result = plans
      .filter(p => p.employee)  // guard for dangling plans
      .map(p => {
        const ev  = evalMap[`${p.employeeId}__${p.month}`];
        const ach = achMap[p.id];
        const emp = p.employee;   // the Sequelize association (as: 'employee')
        return {
          ...p.toJSON(),
          // ── Expose employee under both keys so the frontend works regardless ──
          // Frontend reads plan.employee.name (correct Sequelize key)
          employee: {
            id:           emp?.id,
            name:         emp?.name         || '',
            employeeCode: emp?.employeeCode || '',
            department:   emp?.department   || '',
            role:         emp?.role         || '',
          },
          evaluationStatus:     ev?.status            || null,
          evaluationScore:      ev?.score             || null,
          evaluationRemarks:    ev?.remarks           || null,
          evaluatedAt:          ev?.evaluatedAt       || null,
          hasAchievement:       !!(ach && ach.status !== "DRAFT"),
          achievementStatus:    ach?.status            || null,
          achievementDetails:   ach?.achievementDetails || null,
          planAchievements:     ach?.planAchievements   || [],
          additionalAchievement: ach?.additionalAchievement || null,
          achievementDate:      ach?.submittedAt        || null,
        };
      });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL QUARTERLY EVALUATIONS ─────────────────────────────────────────────── */
exports.getQuarterlyEvalsList = async (req, res) => {
  try {
    const where = {};
    if (req.query.year) where.financialYear = req.query.year;

    const evals = await QuarterlyEvaluation.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: User, as: "ra",       attributes: ["id", "name"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    res.json(evals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL YEARLY PLANS ────────────────────────────────────────────────────────────────── */
exports.getYearlyPlans = async (req, res) => {
  try {
    // FIX: exclude DRAFT plans — MD should only see plans the employee has submitted (PENDING/APPROVED/REJECTED).
    const where = { status: { [Op.ne]: "DRAFT" } };
    if (req.query.financialYear) where.financialYear = req.query.financialYear;

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
    res.status(500).json({ error: error.message });
  }
};

/* ─── ALL YEARLY REPORTS ───────────────────────────────────────────────────────────────── */
exports.getYearlyReports = async (req, res) => {
  try {
    // FIX: exclude DRAFT appraisal reports from the MD view.
    const where = { status: { [Op.ne]: "DRAFT" } };
    if (req.query.financialYear) where.financialYear = req.query.financialYear;

    const reports = await YearlyAppraisalReport.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        {
          model: YearlyPlan,
          as: "linkedYearlyPlan",
          attributes: ["id", "financialYear", "version", "status", "submittedAt", "mdRemarks"],
          include: [
            { model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] },
            { model: YearlyPlanRevisionLog, as: "revisionLog", order: [["revisedAt", "DESC"]] },
          ],
        },
        { model: YearlyAppraisalKraAssessment, as: "kraAssessments", order: [["kraIndex", "ASC"]] },
      ],
      order: [["submittedAt", "DESC"]],
    });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ── MD: SUBMIT MONTHLY EVALUATION FOR AN RA ─────────────────────────────────── */
// Uses evaluatorId instead of raId so the data model stays semantically correct.
exports.submitMonthlyEvaluationForRA = async (req, res) => {
  try {
    const { evaluationId, score, remarks } = req.body;
    const mdId = req.user.userId;

    const evaluation = await MonthlyEvaluation.findByPk(evaluationId, {
      include: [
        { model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "status"] },
        { model: User,        as: "employee",    attributes: ["id", "role", "reportingAuthorityId"] },
      ],
    });

    if (!evaluation) return res.status(404).json({ message: "Evaluation record not found." });

    // Confirm the employee is an RA whose reporting authority is this MD
    if (evaluation.employee?.role !== "RA") {
      return res.status(400).json({ message: "This endpoint is only for evaluating RA employees." });
    }
    if (evaluation.employee?.reportingAuthorityId !== mdId) {
      return res.status(403).json({ message: "This RA does not report to you." });
    }
    // Confirm this is an MD-evaluator record
    if (evaluation.evaluatorId !== mdId) {
      return res.status(403).json({ message: "You are not the designated evaluator for this record." });
    }
    if (evaluation.status === "EVALUATED") {
      return res.status(400).json({ message: "Evaluation already submitted." });
    }
    if (evaluation.monthlyPlan?.status === "REJECTED") {
      return res.status(400).json({ message: "Cannot evaluate: the monthly plan has been rejected." });
    }

    const numScore = Number(score);
    if (!Number.isInteger(numScore) || numScore < 1 || numScore > 10) {
      return res.status(400).json({ message: "Score must be an integer between 1 and 10." });
    }

    evaluation.score       = numScore;
    evaluation.remarks     = remarks || null;
    evaluation.status      = "EVALUATED";
    evaluation.evaluatedAt = new Date();
    await evaluation.save();

    await AuditLog.create({
      userId: mdId, action: "MD_EVALUATE_RA",
      entityType: "MONTHLY_EVALUATION", entityId: String(evaluation.id), ipAddress: req.ip,
    });

    res.json({ message: "Monthly evaluation for RA submitted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit RA evaluation.", error: error.message });
  }
};

/* ── MD: GET MONTHLY EVALUATIONS FOR ALL RAs ─────────────────────────────────── */
// Returns MonthlyEvaluation records where evaluatorId = MD's userId.
// Auto-creates records for RA employees who have submitted plans but have no eval record yet.
exports.getRAMonthlyEvaluations = async (req, res) => {
  try {
    const mdId  = req.user.userId;
    const month = req.query.month;

    if (!month) return res.status(400).json({ message: "month query param is required (YYYY-MM)." });

    // Find all RAs whose reporting authority is this MD
    const raUsers = await User.findAll({
      where: { role: "RA", reportingAuthorityId: mdId, isActive: true }, attributes: ["id"],
    });
    const raIds = raUsers.map(r => r.id);
    if (raIds.length === 0) return res.json([]);

    // Find all monthly plans submitted by these RAs for the requested month
    // FIX: exclude DRAFT plans — MD should not auto-create evaluation records
    // for plans the RA has saved as draft but not yet submitted.
    const plans = await MonthlyPlan.findAll({
      where: {
        employeeId: { [Op.in]: raIds },
        month,
        status: { [Op.ne]: "DRAFT" },   // ← exclude drafts
      },
      attributes: ["id", "employeeId", "month"],
    });

    // Auto-create MonthlyEvaluation records where missing (evaluatorId = mdId, raId = null)
    for (const plan of plans) {
      const exists = await MonthlyEvaluation.findOne({
        where: { employeeId: plan.employeeId, month, evaluatorId: mdId },
      });
      if (!exists) {
        await MonthlyEvaluation.create({
          employeeId: plan.employeeId, monthlyPlanId: plan.id,
          raId: null, evaluatorId: mdId, month, score: 0, remarks: "",
        });
      } else if (!exists.monthlyPlanId || exists.monthlyPlanId !== plan.id) {
        await exists.update({
          monthlyPlanId: plan.id,
          ...(exists.status === "PENDING" ? { score: 0, remarks: "" } : {}),
        });
      }
    }

    // Fetch all evaluation records for these RAs this month
    const evaluations = await MonthlyEvaluation.findAll({
      where: { employeeId: { [Op.in]: raIds }, month, evaluatorId: mdId },
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        {
          model: MonthlyPlan, as: "monthlyPlan",
          attributes: ["id", "month", "planDetails", "status", "submittedAt"],
          include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Attach FULL achievement data so the frontend can render plan+achievement detail view
    const planIds = evaluations.map(ev => ev.monthlyPlanId).filter(Boolean);
    const achievements = planIds.length > 0
      ? await MonthlyAchievement.findAll({
          where: { monthlyPlanId: { [Op.in]: planIds } },
          include: [{ model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] }],
        })
      : [];

    // BUG FIX: achSet was referenced below but never defined, causing a
    // ReferenceError at runtime which crashed the entire endpoint (500 error)
    // and the frontend showed "No RA plans found".
    const achSet = new Set(achievements.map(a => String(a.monthlyPlanId)));
    // Build a lookup map so we can attach the full achievement object per plan
    const achByPlanId = Object.fromEntries(achievements.map(a => [String(a.monthlyPlanId), a]));

    const response = evaluations.map(ev => ({
      id: ev.id, employee: ev.employee, month: ev.month,
      score: ev.score, remarks: ev.remarks || null,
      status: ev.status, evaluatedAt: ev.evaluatedAt,
      monthlyPlan: ev.monthlyPlan,
      hasAchievement: ev.monthlyPlanId ? achSet.has(String(ev.monthlyPlanId)) : false,
      // BUG FIX 2: include full achievement object so the detail modal can render
      // plan+achievement data in the RA tab (frontend reads plan.achievement)
      achievement: ev.monthlyPlanId ? (achByPlanId[String(ev.monthlyPlanId)] || null) : null,
    }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch RA monthly evaluations.", error: error.message });
  }
};

/* ─── MD RA-ELIGIBILITY CHECK ──────────────────────────────────────────────────
 *  Called by the frontend on MD login/load to decide whether to show the
 *  "Switch to RA View" button. Returns { isRA: bool, subordinateCount: number }.
 *
 *  "isRA" is true when at least one employee (of any role) has reportingAuthorityId
 *  equal to the MD's own userId — i.e., the MD acts as a direct RA for those people.
 *
 *  This is scoped to direct reports only (second interpretation confirmed by user):
 *  employees who report to an RA who reports to MD are NOT counted here.
 * ──────────────────────────────────────────────────────────────────────────── */
exports.checkRAEligibility = async (req, res) => {
  try {
    const mdId = req.user.userId;

    // Count employees (any role) who directly report to this MD user
    const subordinateCount = await User.count({
      where: { reportingAuthorityId: mdId },
    });

    res.json({
      isRA: subordinateCount > 0,
      subordinateCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to check RA eligibility.", error: error.message });
  }
};

