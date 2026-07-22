// ─────────────────────────────────────────────────────────────────────────────
//  RA CONTROLLER  —  Mongoose → Sequelize conversion
//
//  KEY CHANGES:
//  1. All imports from '../models' (single source)
//  2. find(filter)          → findAll({ where: filter })
//  3. findById(id)          → findByPk(id)
//  4. findOne({...})        → findOne({ where: {...} })
//  5. countDocuments(...)   → Model.count({ where: {...} })
//  6. _id                   → id throughout
//  7. $in / $or / $ne       → Op.in / Op.or / Op.ne
//  8. populate()            → include: [{ model, as, attributes }]
//  9. findByIdAndUpdate     → Model.update + findByPk (or instance.update)
//  10. entityId stored as String (polymorphic ref — no FK in PostgreSQL)
//  11. Inline User require  → moved to top-level import
//  12. Quarterly auto-generation: MonthlyEvaluation.findByIdAndUpdate → instance.update
//  13. planItems / planAchievements in getQuarterlyFullDetail
//      → fetched via include (separate tables) instead of embedded fields
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
  YearlyAppraisalReport,
  YearlyAppraisalKraAssessment,
  AuditLog,
  Notification,
  EmployeeRAHistory,
} = require("../models");

const { Op } = require("sequelize");
const { getQuarterMonthStrings } = require("../utils/fiscalUtils");

/* helper — mirrors the old in-file function */
function getQuarterMonths(quarter) {
  return getQuarterMonthStrings(quarter);
}

/* ─── 1. RA DASHBOARD ────────────────────────────────────────────────────────── */
exports.getRADashboard = async (req, res) => {
  try {
    const raId = req.user.userId;
    const { month } = req.query;


    if (!month) return res.status(400).json({ message: "Month is required" });

    // ── Compute month boundaries for the overlap query ───────────────────────────
    //  An employee is counted under this RA for the selected month if and only if
    //  there exists a history record where:
    //    effectiveFrom <= last moment of the month   (assignment started before month ended)
    //    AND (effectiveTo IS NULL                    (still active)
    //         OR effectiveTo >= first moment of month)  (was still active at some point in the month)
    //
    //  This is the standard date-range overlap check and correctly handles:
    //   • Employees who joined this RA mid-month (effectiveFrom inside the month)
    //   • Employees who left this RA mid-month  (effectiveTo inside the month)
    //   • Employees who were only ever with this RA (effectiveTo IS NULL)
    const [selYear, selMonthNum] = month.split("-").map(Number);
    const startOfMonth = new Date(selYear, selMonthNum - 1, 1, 0, 0, 0, 0);       // e.g. 2026-05-01 00:00:00
    const endOfMonth = new Date(selYear, selMonthNum, 0, 23, 59, 59, 999);  // e.g. 2026-05-31 23:59:59

    // FIX: query EmployeeRAHistory instead of User.reportingAuthorityId + createdAt.
    // This correctly handles RA reassignments: if an employee moved from RA A → RA B
    // in June, they appear under RA A for May and under RA B for June.
    const historyRows = await EmployeeRAHistory.findAll({
      where: {
        raId: raId,
        effectiveFrom: { [Op.lte]: endOfMonth },           // assignment started by end of month
        [Op.or]: [
          { effectiveTo: null },                           // still active with this RA
          { effectiveTo: { [Op.gte]: startOfMonth } },     // or was active at some point this month
        ],
      },
      attributes: ["employeeId"],
    });
    const employeeIds = [...new Set(historyRows.map(h => h.employeeId))];
    const totalEmployees = employeeIds.length;

    // CHANGE 7: { $in: employeeIds } → Op.in
    // FIX: exclude DRAFT plans — only count plans the employee has actually submitted.
    const submittedPlans = employeeIds.length > 0 ? await MonthlyPlan.findAll({
      where: {
        employeeId: { [Op.in]: employeeIds },
        month,
        status: { [Op.ne]: "DRAFT" },   // ← exclude drafts
      },
      attributes: ["id", "employeeId"],
    }) : [];

    const planIds = submittedPlans.map(p => p.id);
    const submittedEmployeeIds = submittedPlans.map(p => p.employeeId);

    const achievements = planIds.length > 0 ? await MonthlyAchievement.findAll({
      where: { monthlyPlanId: { [Op.in]: planIds } },
      include: [{ model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "employeeId"] }],
    }) : [];

    const achievementsThisMonth = achievements.length;
    const achievementEmployeeIds = achievements.map(a => a.monthlyPlan?.employeeId).filter(Boolean);

    const evaluated = employeeIds.length > 0 ? await MonthlyEvaluation.findAll({
      where: { employeeId: { [Op.in]: employeeIds }, month, raId, status: "EVALUATED" },
      attributes: ["employeeId"],
    }) : [];

    const evaluatedThisMonth = evaluated.length;
    const evaluatedEmployeeIds = evaluated.map(e => e.employeeId);

    // CHANGE 5: countDocuments → count
    // Guard Op.in([]) — PostgreSQL throws on empty IN lists
    const pendingEvaluation = employeeIds.length > 0 ? await MonthlyEvaluation.count({
      where: { employeeId: { [Op.in]: employeeIds }, month, raId, status: "PENDING" },
    }) : 0;

    const submittedSet = new Set(submittedEmployeeIds.map(String));
    const notSubmitted = employeeIds.filter(id => !submittedSet.has(String(id)));
    const notYetSubmitted = notSubmitted.length;

    const pendingYearly = employeeIds.length > 0 ? await YearlyAppraisalReport.count({
      where: { employeeId: { [Op.in]: employeeIds }, status: "SUBMITTED" },
    }) : 0;

    // CHANGE 7: { $or: [{ remarks: null }, { remarks: '' }, { remarks: { $exists: false } }] }
    //           → Op.or with Op.is, Op.eq
    const pendingQuarterlyRemarks = await QuarterlyEvaluation.count({
      where: {
        raId,
        [Op.or]: [
          { remarks: null },
          { remarks: "" },
        ],
      },
    });

    res.json({
      totalEmployees, plansSubmittedThisMonth: submittedPlans.length,
      achievementsThisMonth, evaluatedThisMonth, pendingEvaluation,
      notYetSubmitted, pendingYearly, pendingQuarterlyRemarks,
      lists: { submitted: submittedEmployeeIds, achievements: achievementEmployeeIds, evaluated: evaluatedEmployeeIds, notSubmitted: notSubmitted },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load RA dashboard", error: error.message });
  }
};

/* ─── MONTHLY TREND ──────────────────────────────────────────────────────────── */
exports.getMonthlyTrend = async (req, res) => {
  try {
    const raId = req.user.userId;
    const employees = await User.findAll({ where: { reportingAuthorityId: raId }, attributes: ["id"] });
    const employeeIds = employees.map(e => e.id);

    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const trendData = await Promise.all(
      months.map(async (monthStr) => {
        if (employeeIds.length === 0) {
          const [year, mon] = monthStr.split("-");
          const shortMonth = new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString("en-US", { month: "short" });
          return { month: monthStr, shortMonth, plans: 0, achievements: 0, evaluations: 0 };
        }

        // FIX: exclude DRAFT plans — trend should reflect submitted plans only.
        const monthPlans = await MonthlyPlan.findAll({
          where: {
            employeeId: { [Op.in]: employeeIds },
            month: monthStr,
            status: { [Op.ne]: "DRAFT" },   // ← exclude drafts
          },
          attributes: ["id"],
        });
        const planIds = monthPlans.map(p => p.id);

        const achievements = planIds.length > 0
          ? await MonthlyAchievement.count({ where: { monthlyPlanId: { [Op.in]: planIds } } })
          : 0;
        const evaluations = await MonthlyEvaluation.count({
          where: { employeeId: { [Op.in]: employeeIds }, month: monthStr, raId, status: "EVALUATED" },
        });

        const [year, mon] = monthStr.split("-");
        const shortMonth = new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString("en-US", { month: "short" });

        return { month: monthStr, shortMonth, plans: monthPlans.length, achievements, evaluations };
      })
    );

    res.json(trendData);
  } catch (error) {
    res.status(500).json({ message: "Failed to load monthly trend", error: error.message });
  }
};

/* ─── GET EMPLOYEES UNDER RA ─────────────────────────────────────────────────── */
exports.getMyEmployees = async (req, res) => {
  try {
    const raId = req.user.userId;
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // ── Resolve employee IDs for the requested month ─────────────────────────
    //  If a ?month=YYYY-MM is provided, use EmployeeRAHistory (same date-overlap
    //  logic as getRADashboard) so the list reflects who was actually under this
    //  RA in that month.  Without a month param, fall back to the current
    //  reportingAuthorityId snapshot (backwards-compatible).
    let employeeIds = null;

    if (req.query.month) {
      const [selYear, selMonthNum] = req.query.month.split("-").map(Number);
      const startOfMonth = new Date(selYear, selMonthNum - 1, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(selYear, selMonthNum, 0, 23, 59, 59, 999);

      const historyRows = await EmployeeRAHistory.findAll({
        where: {
          raId,
          effectiveFrom: { [Op.lte]: endOfMonth },
          [Op.or]: [
            { effectiveTo: null },
            { effectiveTo: { [Op.gte]: startOfMonth } },
          ],
        },
        attributes: ["employeeId"],
      });
      employeeIds = [...new Set(historyRows.map(h => h.employeeId))];
    }

    // Fetch full employee records — either the history-derived set or all current
    const employees = employeeIds !== null
      ? await User.findAll({
        where: { id: { [Op.in]: employeeIds }, isActive: true },
        attributes: ["id", "name", "employeeCode", "department", "email", "createdAt"],
      })
      : await User.findAll({
        where: { reportingAuthorityId: raId, isActive: true },
        attributes: ["id", "name", "employeeCode", "department", "email", "createdAt"],
      });

    const result = await Promise.all(
      employees.map(async (emp) => {
        const [totalPlans, totalEvaluated, totalAchievements, currentMonthPlan, currentMonthAchievement, currentMonthEvaluation] = await Promise.all([
          MonthlyPlan.count({ where: { employeeId: emp.id } }),
          MonthlyEvaluation.count({ where: { employeeId: emp.id, raId, status: "EVALUATED" } }),
          MonthlyAchievement.count({ where: { employeeId: emp.id } }),
          // CHANGE 7: { status: { $ne: "DRAFT" } } → Op.ne
          MonthlyPlan.findOne({ where: { employeeId: emp.id, month: currentMonth, status: { [Op.ne]: "DRAFT" } }, attributes: ["id"] }),
          MonthlyAchievement.findOne({ where: { employeeId: emp.id }, attributes: ["id"] }),
          MonthlyEvaluation.findOne({ where: { employeeId: emp.id, raId, month: currentMonth, status: "EVALUATED" }, attributes: ["id"] }),
        ]);

        return {
          id: emp.id, name: emp.name, employeeCode: emp.employeeCode,
          department: emp.department, email: emp.email, joinedAt: emp.createdAt,
          totalPlans, totalEvaluated, totalAchievements, currentMonth,
          currentMonthPlanSubmitted: !!currentMonthPlan,
          currentMonthAchievementSubmitted: !!currentMonthAchievement,
          currentMonthEvaluated: !!currentMonthEvaluation,
        };
      })
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch employees", error: error.message });
  }
};


/* ─── EMPLOYEE DETAIL (RA VIEW) ──────────────────────────────────────────────── */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const raId = req.user.userId;

    const employee = await User.findByPk(id, {
      attributes: ["id", "name", "employeeCode", "department", "role", "reportingAuthorityId", "isActive", "email", "createdAt"],
      include: [{ model: User, as: "reportingAuthority", attributes: ["id", "name"] }],
    });

    if (!employee) return res.status(404).json({ message: "Employee not found" });

    // CHANGE 6: ._id → .id for authorization check
    if (employee.reportingAuthorityId !== raId) {
      return res.status(403).json({ message: "You are not authorized to view this employee's details" });
    }

    const [monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports] = await Promise.all([
      MonthlyPlan.findAll({ where: { employeeId: id }, include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }], order: [["month", "DESC"]] }),
      MonthlyAchievement.findAll({ where: { employeeId: id }, include: [{ model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "month", "planDetails"] }, { model: MonthlyAchievementItem, as: "planAchievements" }], order: [["submittedAt", "DESC"]] }),
      MonthlyEvaluation.findAll({ where: { employeeId: id }, include: [{ model: User, as: "ra", attributes: ["id", "name"] }], order: [["month", "DESC"]] }),
      QuarterlyEvaluation.findAll({ where: { employeeId: id }, include: [{ model: User, as: "ra", attributes: ["id", "name"] }], order: [["createdAt", "DESC"]] }),
      YearlyPlan.findAll({ where: { employeeId: id }, include: [{ model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] }], order: [["submittedAt", "DESC"]] }),
      YearlyAppraisalReport.findAll({ where: { employeeId: id }, include: [{ model: YearlyAppraisalKraAssessment, as: "kraAssessments" }], order: [["submittedAt", "DESC"]] }),
    ]);

    res.json({ employee, monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── 2. SUBMIT MONTHLY EVALUATION ──────────────────────────────────────────── */
exports.submitMonthlyEvaluation = async (req, res) => {
  try {
    const { evaluationId, score, remarks } = req.body;

    // Allow RA — and MD acting as RA (MD evaluates their direct reports via RA view).
    // Hard-reject everyone else (EMPLOYEE, HRD).
    if (req.user.role !== "RA" && req.user.role !== "MD") {
      return res.status(403).json({ message: "Only Reporting Authority can evaluate" });
    }

    const evaluation = await MonthlyEvaluation.findByPk(evaluationId, {
      include: [{ model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "status"] }],
    });
    if (!evaluation) return res.status(404).json({ message: "Evaluation not found" });
    if (evaluation.status === "EVALUATED") return res.status(400).json({ message: "Evaluation already submitted" });

    // ── Ownership check ──────────────────────────────────────────────────────
    //  For RA:  evaluation.raId must equal this RA's userId.
    //  For MD:  the employee must directly report to the MD
    //           (reportingAuthorityId = MD's userId), OR the evaluation record
    //           was created with raId = MD's userId (unlikely but safe to allow).
    if (req.user.role === "RA" && evaluation.raId !== req.user.userId) {
      return res.status(403).json({ message: "You are not authorized to evaluate this record" });
    }
    if (req.user.role === "MD") {
      // Verify the employee directly reports to the MD
      const emp = await User.findByPk(evaluation.employeeId, { attributes: ["reportingAuthorityId"] });
      if (!emp || String(emp.reportingAuthorityId) !== String(req.user.userId)) {
        return res.status(403).json({ message: "You are not authorized to evaluate this record" });
      }
    }

    // ── BUSINESS RULE: Cannot evaluate a rejected plan ──────────────────────
    // The employee must revise and resubmit the plan before the RA can evaluate.
    // This guard prevents bypassing the frontend via direct API calls.
    if (evaluation.monthlyPlan?.status === "REJECTED") {
      return res.status(400).json({
        message: "Cannot evaluate: the monthly plan has been rejected. The employee must revise and resubmit before evaluation can proceed.",
      });
    }

    // Validate score range
    const numScore = Number(score);
    if (!Number.isInteger(numScore) || numScore < 1 || numScore > 10) {
      return res.status(400).json({ message: "Score must be an integer between 1 and 10." });
    }

    evaluation.score = numScore;
    evaluation.remarks = remarks || null;
    evaluation.status = "EVALUATED";
    evaluation.evaluatedAt = new Date();
    await evaluation.save();

    await AuditLog.create({ userId: req.user.userId, action: "EVALUATE", entityType: "MONTHLY_EVALUATION", entityId: String(evaluation.id), ipAddress: req.ip });
    res.json({ message: "Monthly evaluation submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit evaluation", error: error.message });
  }
};


/* ─── 3. GET MONTHLY EVALUATIONS ─────────────────────────────────────────────── */
exports.getMonthlyEvaluations = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const where = {};
    let excludeScore = false;

    if (req.user.role === "EMPLOYEE") {
      where.employeeId = req.user.userId;
      excludeScore = true;
    } else if (req.user.role === "RA") {
      // selfView=true  → RA viewing their OWN evaluations (as an employee, evaluatorId = MD)
      // selfView=false → RA viewing their TEAM evaluations  (raId = this RA)
      const isSelfView = req.query.selfView === "true";

      if (isSelfView) {
        // RA as employee: find records where I am the subject (employeeId=me).
        // excludeScore = true mirrors the EMPLOYEE behaviour — the score is
        // never shown to the subject of the evaluation (only remarks are visible).
        where.employeeId = req.user.userId;
        excludeScore = true;   // ← hide score just like any other employee
      } else {
        // RA as evaluator: find records where I am the RA
        where.raId = req.user.userId;

        // Auto-create missing evaluation records for RA's employees this month
        // IMPORTANT: exclude the RA themselves from this loop
        if (req.query.month) {
          const myEmps = await User.findAll({
            where: { reportingAuthorityId: req.user.userId },
            attributes: ["id"],
          });
          // Exclude RA's own userId so we never auto-create a team-eval for themselves
          const myEmpIds = myEmps.map(e => e.id).filter(id => id !== req.user.userId);

          // Guard: skip if no employees — Op.in([]) causes invalid SQL in some DB drivers
          if (myEmpIds.length > 0) {
            // CRITICAL FIX: Only include plans that have actually been submitted
            // (status !== "DRAFT"). A DRAFT plan means the employee has saved their
            // work locally but has NOT submitted it for RA review. Previously, this
            // query fetched ALL plans including DRAFTs, which caused draft plans to
            // appear in the RA's evaluation queue — a clear business-logic violation.
            const plans = await MonthlyPlan.findAll({
              where: {
                employeeId: { [Op.in]: myEmpIds },
                month: req.query.month,
                status: { [Op.ne]: "DRAFT" },   // ← exclude drafts
              },
              attributes: ["id", "employeeId", "month"],
            });

            for (const plan of plans) {
              // ── Look up by monthlyPlanId (UNIQUE key), NOT by (employeeId, month, raId).
              //
              //  Why: monthlyPlanId has a UNIQUE constraint — only ONE MonthlyEvaluation
              //  can exist per plan. If an employee is reassigned from RA_A → RA_B:
              //    • The old record has  { monthlyPlanId: X, raId: RA_A }
              //    • findOne({ raId: RA_B }) returns null
              //    • create({ monthlyPlanId: X, raId: RA_B }) → unique-constraint crash (500)
              //
              //  Correct approach: find the record by the plan's unique id.
              //  • No record exists  → create fresh for this RA.
              //  • Record exists, same RA, wrong planId → update planId (plan was resubmitted).
              //  • Record exists, different RA, PENDING → reassign to this RA (employee moved).
              //  • Record exists, EVALUATED → leave it alone; evaluation is done.
              const existsByPlan = await MonthlyEvaluation.findOne({
                where: { monthlyPlanId: plan.id },
              });

              if (!existsByPlan) {
                // No evaluation record for this plan at all — create one.
                await MonthlyEvaluation.create({
                  employeeId: plan.employeeId,
                  monthlyPlanId: plan.id,
                  raId: req.user.userId,
                  evaluatorId: null,
                  month: plan.month,
                  score: 0,
                  remarks: "",
                });
              } else if (
                existsByPlan.raId !== req.user.userId &&
                existsByPlan.status === "PENDING"
              ) {
                // Record belongs to a different RA (employee was reassigned) and is
                // still pending — reassign to the current RA so they can evaluate it.
                await existsByPlan.update({
                  raId: req.user.userId,
                  score: 0,
                  remarks: "",
                });
              }
              // If status === "EVALUATED" or raId already matches: no action needed.
            }
          }
        }
      }
    } else if (req.user.role === "MD") {
      // ── MD in RA-View ────────────────────────────────────────────────────────
      //  MD evaluates their direct reports (employees whose reportingAuthorityId = MD).
      //
      //  IMPORTANT — why NOT raId = MD's userId:
      //    Existing MonthlyEvaluation rows are created by the employee's own RA
      //    (raId = that RA's userId). MD never appears as raId in those rows.
      //    Setting raId = MD's userId would return 0 results.
      //
      //  IMPORTANT — why NOT auto-create rows here:
      //    monthlyPlanId has a UNIQUE constraint (one evaluation per plan).
      //    The plan already has an evaluation row (raId = the RA who created it).
      //    Trying to create a second row for the same plan → Validation error (500).
      //
      //  Correct approach: filter by employeeId IN [MD's direct reports].
      //  MD can then view and evaluate those records (the evaluate endpoint uses
      //  MonthlyEvaluation.update, not create, so no uniqueness issue there).
      if (!req.query.month && !req.query.year) {
        return res.status(400).json({ message: "Month or year is required for MD view" });
      }

      // Fetch MD's direct reports
      const directReports = await User.findAll({
        where: { reportingAuthorityId: req.user.userId },
        attributes: ["id"],
      });
      const directReportIds = directReports.map(u => u.id);

      if (directReportIds.length === 0) {
        // MD has no direct reports — return empty result immediately
        return res.json({ page: 1, limit, totalRecords: 0, totalPages: 0, data: [] });
      }

      // Scope the main query to direct reports only
      where.employeeId = { [Op.in]: directReportIds };

    } else if (req.user.role === "HRD") {
      if (!req.query.month && !req.query.year) return res.status(400).json({ message: "Month or year is required for HRD view" });
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
    }

    if (req.query.month) where.month = req.query.month;

    const evaluations = await MonthlyEvaluation.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        {
          model: MonthlyPlan, as: "monthlyPlan", attributes: ["id", "month", "planDetails", "status", "raRemarks", "submittedAt"],
          include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }]
        },
        // ra may be null when evaluatorId is used (MD→RA flow) — Sequelize handles nullable FK fine
        { model: User, as: "ra", attributes: ["id", "name", "employeeCode"], required: false },
        { model: User, as: "evaluator", attributes: ["id", "name"], required: false },
      ],
      order: [["createdAt", "DESC"]],
      offset,
      limit,
    });

    const totalCount = await MonthlyEvaluation.count({ where });

    const planIds = evaluations.map(ev => ev.monthlyPlanId).filter(Boolean);
    // Guard: Op.in([]) generates invalid SQL in PostgreSQL ("IN ()") → 500.
    // When no evaluations have a linked plan, skip the achievement lookup entirely.
    const achSet = new Set();
    if (planIds.length > 0) {
      const achievements = await MonthlyAchievement.findAll({
        where: { monthlyPlanId: { [Op.in]: planIds } },
        attributes: ["monthlyPlanId"],
      });
      achievements.forEach(a => achSet.add(String(a.monthlyPlanId)));
    }

    const response = evaluations.map(ev => ({
      id: ev.id,
      employee: ev.employee,
      month: ev.month,
      remarks: ev.remarks || null,
      score: excludeScore ? null : ev.score,
      status: ev.status,
      monthlyPlanId: ev.monthlyPlan,
      hasAchievement: ev.monthlyPlanId ? achSet.has(String(ev.monthlyPlanId)) : false,
    }));

    res.json({ page, limit, totalRecords: totalCount, totalPages: Math.ceil(totalCount / limit), data: response });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly evaluations", error: error.message });
  }
};

/* ─── 4. GET MONTHLY EVALUATION BY ID ───────────────────────────────────────── */
exports.getMonthlyEvaluationById = async (req, res) => {
  try {
    const evaluation = await MonthlyEvaluation.findByPk(req.params.id, {
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: MonthlyPlan, as: "monthlyPlan", include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }] },
        { model: User, as: "ra", attributes: ["id", "name", "employeeCode"] },
      ],
    });

    if (!evaluation) return res.status(404).json({ message: "Monthly evaluation not found" });

    // CHANGE 6: ._id → .id
    if (req.user.role === "RA" && evaluation.ra?.id !== req.user.userId) return res.status(403).json({ message: "Not authorized" });
    if (req.user.role === "EMPLOYEE" && evaluation.employee?.id !== req.user.userId) return res.status(403).json({ message: "Not authorized" });

    const planDoc = evaluation.monthlyPlan || null;
    const achievement = planDoc
      ? await MonthlyAchievement.findOne({ where: { monthlyPlanId: planDoc.id }, include: [{ model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] }] })
      : null;

    const canViewScore = ["RA", "HRD", "MD"].includes(req.user.role);

    res.json({
      plan: planDoc,
      achievement: achievement || null,
      remarks: evaluation.remarks || null,
      score: canViewScore ? evaluation.score : null,
      status: {
        planSubmitted: !!planDoc,
        achievementSubmitted: !!achievement,
        evaluated: evaluation.status === "EVALUATED",
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly evaluation", error: error.message });
  }
};

/* ─── 5. GENERATE QUARTERLY EVALUATIONS ─────────────────────────────────────── */
exports.generateQuarterlyEvaluation = async (req, res) => {
  try {
    const { quarter, remarks } = req.body;
    const raId = req.user.userId;

    // Allow RA — and MD acting as RA (MD generates quarterly eval for their direct reports).
    if (req.user.role !== "RA" && req.user.role !== "MD") {
      return res.status(403).json({ message: "Only Reporting Authority can generate quarterly evaluation" });
    }
    if (!quarter) return res.status(400).json({ message: "quarter is required (e.g. Q1-2026)" });

    const quarterMonths = getQuarterMonths(quarter);
    if (!quarterMonths) return res.status(400).json({ message: "Invalid quarter format. Use Q1-2026, Q2-2026, etc." });

    const myEmployees = await User.findAll({ where: { reportingAuthorityId: raId }, attributes: ["id"] });
    const myEmpIds = myEmployees.map(e => e.id);

    let generated = 0, skipped = 0;
    const results = [];

    for (const empId of myEmpIds) {
      const existing = await QuarterlyEvaluation.findOne({ where: { employeeId: empId, quarter } });
      if (existing) { skipped++; continue; }

      const evals = await MonthlyEvaluation.findAll({
        where: { employeeId: empId, raId, month: { [Op.in]: quarterMonths }, status: "EVALUATED" },
        attributes: ["score"],
      });

      if (evals.length === 3) {
        const totalScore = evals.reduce((sum, ev) => sum + (ev.score || 0), 0);
        const averageScore = +(totalScore / 3).toFixed(2);

        const quarterly = await QuarterlyEvaluation.create({ employeeId: empId, quarter, raId, averageScore, remarks: remarks || null });

        await AuditLog.create({ userId: raId, action: "GENERATE", entityType: "QUARTERLY_EVALUATION", entityId: String(quarterly.id), ipAddress: req.ip });

        await Notification.create({
          userId: empId, type: "QUARTERLY_EVALUATED",
          title: "Quarterly Evaluation Generated",
          message: remarks
            ? `Your quarterly evaluation for ${quarter} has been generated and your RA has given remarks.`
            : `Your quarterly evaluation for ${quarter} has been generated.`,
          entityType: "QUARTERLY_EVALUATION", entityId: String(quarterly.id),
        });

        generated++;
        results.push({ employeeId: empId, averageScore });
      }
    }

    res.json({ message: `Quarterly evaluations generated: ${generated}, skipped: ${skipped}`, generated, skipped, results });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate quarterly evaluation", error: error.message });
  }
};

/* ─── 5b. GET QUARTERLY DETAIL ───────────────────────────────────────────────── */
exports.getQuarterlyDetail = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findByPk(req.params.id, {
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: User, as: "ra", attributes: ["id", "name", "employeeCode"] },
      ],
    });

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });
    if (req.user.role === "RA" && quarterly.ra?.id !== req.user.userId) return res.status(403).json({ message: "Not authorized" });

    const quarterMonths = getQuarterMonths(quarterly.quarter);
    // NOTE: do NOT filter by raId here.
    //  For MD-generated quarterly evals, quarterly.raId = MD's userId, but the
    //  MonthlyEvaluation records retain their original raId (the RA who was set
    //  when the record was first created). Filtering by raId would return 0 rows.
    //  The correct key is (employeeId, month) — at most one EVALUATED record per
    //  employee per month due to the unique monthlyPlanId constraint.
    const monthlyEvals = await MonthlyEvaluation.findAll({
      where: { employeeId: quarterly.employeeId, month: { [Op.in]: quarterMonths }, status: "EVALUATED" },
      order: [["month", "ASC"]],
    });
    // Deduplicate: keep one record per month (defensive against edge cases)
    const seenM = new Set();
    const deduplicatedMonthlyEvals = monthlyEvals.filter(ev => { if (seenM.has(ev.month)) return false; seenM.add(ev.month); return true; });

    res.json({
      id: quarterly.id, employee: quarterly.employee, quarter: quarterly.quarter,
      averageScore: quarterly.averageScore, remarks: quarterly.remarks, generatedAt: quarterly.createdAt,
      monthlyBreakdown: deduplicatedMonthlyEvals.map(ev => ({ month: ev.month, score: ev.score, remarks: ev.remarks, evaluatedAt: ev.evaluatedAt })),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quarterly detail", error: error.message });
  }
};

/* ─── 5c. UPDATE QUARTERLY REMARKS ──────────────────────────────────────────── */
exports.updateQuarterlyRemarks = async (req, res) => {
  try {
    const { remarks } = req.body;
    const quarterly = await QuarterlyEvaluation.findByPk(req.params.id);

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });

    // ── Authorization ─────────────────────────────────────────────────────────
    //  RA:  the raId on this quarterly record must match the logged-in RA.
    //  MD:  raId won't match MD's userId (the record was created by the original RA),
    //       so check ownership via the employee's current reportingAuthorityId instead.
    const isAuthorizedRA = req.user.role === "RA" && quarterly.raId === req.user.userId;
    let isAuthorizedMD = false;
    if (req.user.role === "MD") {
      const emp = await User.findByPk(quarterly.employeeId, { attributes: ["reportingAuthorityId"] });
      isAuthorizedMD = emp && String(emp.reportingAuthorityId) === String(req.user.userId);
    }
    if (!isAuthorizedRA && !isAuthorizedMD) {
      return res.status(403).json({ message: "Not authorized" });
    }

    quarterly.remarks = remarks;
    await quarterly.save();

    await Notification.create({
      userId: quarterly.employeeId, type: "QUARTERLY_EVALUATED",
      title: "Quarterly Evaluation Remarks",
      message: `Your RA has provided remarks on your quarterly evaluation for ${quarterly.quarter}.`,
      entityType: "QUARTERLY_EVALUATION", entityId: String(quarterly.id),
    });

    res.json({ message: "Remarks updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update remarks", error: error.message });
  }
};

/* ─── GET QUARTERLY EVALUATIONS (list) ──────────────────────────────────────── */
exports.getQuarterlyEvaluations = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const where = {};
    let excludeScore = false;

    if (req.user.role === "EMPLOYEE") {
      // ── Plain employee: see evaluations received by them ──
      where.employeeId = req.user.userId;
      excludeScore = true;
    } else if (req.user.role === "RA" && req.query.asEmployee === "true") {
      // ── RA acting as employee (switched to Employee View) ──
      //  They want to see the quarterly evaluation that THEIR reporting authority gave THEM,
      //  not the evaluations they gave to their own subordinates.
      //  Filter by employeeId (the RA is the employee here) and hide the raw averageScore
      //  exactly as we do for plain EMPLOYEE users.
      where.employeeId = req.user.userId;
      excludeScore = true;
    } else if (req.user.role === "RA") {
      where.raId = req.user.userId;

      // Auto-generate quarterly records if not yet done
      if (req.query.quarter) {
        const quarterMonths = getQuarterMonths(req.query.quarter);
        if (quarterMonths) {
          const myEmps = await User.findAll({ where: { reportingAuthorityId: req.user.userId }, attributes: ["id"] });
          const myEmpIds = myEmps.map(e => e.id);

          for (const empId of myEmpIds) {
            const existing = await QuarterlyEvaluation.findOne({ where: { employeeId: empId, quarter: req.query.quarter } });

            // Always fetch evaluated monthly records — used for both create and recalc paths
            const evals = await MonthlyEvaluation.findAll({
              where: { employeeId: empId, raId: req.user.userId, month: { [Op.in]: quarterMonths }, status: "EVALUATED" },
              attributes: ["score"],
            });

            if (existing) {
              // BUG FIX: previously we `continue`d here, leaving stale/zero averageScore
              // permanently in the DB. Now we recalculate from live monthly evaluations
              // and persist the corrected value so both list and detail views stay accurate.
              if (evals.length > 0) {
                const total = evals.reduce((sum, ev) => sum + Number(ev.score || 0), 0);
                const recalcAvg = +(total / evals.length).toFixed(2);
                const storedAvg = parseFloat(existing.averageScore);
                // Only write if the value is actually wrong (null, 0, or diverged)
                if (isNaN(storedAvg) || storedAvg === 0 || Math.abs(storedAvg - recalcAvg) > 0.005) {
                  await existing.update({ averageScore: recalcAvg });
                }
              }
              continue;
            }

            if (evals.length === 3) {
              const totalScore = evals.reduce((sum, ev) => sum + Number(ev.score || 0), 0);
              const averageScore = +(totalScore / 3).toFixed(2);
              await QuarterlyEvaluation.create({ employeeId: empId, quarter: req.query.quarter, raId: req.user.userId, averageScore, remarks: null });
            }
          }
        }
      }
    } else if (req.user.role === "MD") {
      // ── MD in RA-View ────────────────────────────────────────────────────────
      //  MD sees quarterly evaluations for their direct reports only.
      //
      //  IMPORTANT — why NOT raId = MD's userId in the main query:
      //    QuarterlyEvaluation rows are created with raId = the original RA's userId.
      //    MD never appears as raId in pre-existing rows, so raId = MD's id returns 0.
      //    Correct approach: filter by employeeId IN [MD's direct reports].
      //
      //  IMPORTANT — why the monthly eval query has NO raId filter:
      //    When MD evaluates a monthly plan, the MonthlyEvaluation record retains its
      //    original raId (the RA who was assigned when the record was created — could be
      //    a different RA or null). Filtering by raId = MD's userId would find 0 rows
      //    and the quarterly auto-generation would never fire.
      const directReports = await User.findAll({
        where: { reportingAuthorityId: req.user.userId },
        attributes: ["id"],
      });
      const directReportIds = directReports.map(u => u.id);

      if (directReportIds.length === 0) {
        return res.json({ page: 1, limit, totalRecords: 0, totalPages: 0, data: [] });
      }

      // ── Auto-generate quarterly records for MD's direct reports ──────────────
      if (req.query.quarter) {
        const quarterMonths = getQuarterMonths(req.query.quarter);
        if (quarterMonths) {
          for (const empId of directReportIds) {
            const existing = await QuarterlyEvaluation.findOne({
              where: { employeeId: empId, quarter: req.query.quarter },
            });

            // Fetch evaluated monthly records for this employee for the quarter.
            // NO raId filter — the records may have raId = original RA's id, not MD's.
            const evals = await MonthlyEvaluation.findAll({
              where: {
                employeeId: empId,
                month: { [Op.in]: quarterMonths },
                status: "EVALUATED",
              },
              attributes: ["score", "month"],
            });

            // Deduplicate: keep only one record per month (edge case: multiple RAs)
            const seenMonths = new Set();
            const uniqueEvals = evals.filter(ev => {
              if (seenMonths.has(ev.month)) return false;
              seenMonths.add(ev.month);
              return true;
            });

            if (existing) {
              // Recalculate averageScore from live evaluated monthly records
              if (uniqueEvals.length > 0) {
                const total = uniqueEvals.reduce((sum, ev) => sum + Number(ev.score || 0), 0);
                const recalcAvg = +(total / uniqueEvals.length).toFixed(2);
                const storedAvg = parseFloat(existing.averageScore);
                if (isNaN(storedAvg) || storedAvg === 0 || Math.abs(storedAvg - recalcAvg) > 0.005) {
                  await existing.update({ averageScore: recalcAvg });
                }
              }
              continue;
            }

            // All 3 months evaluated → create quarterly evaluation with raId = MD's userId
            // so updateQuarterlyRemarks ownership check works correctly.
            if (uniqueEvals.length === 3) {
              const totalScore = uniqueEvals.reduce((sum, ev) => sum + Number(ev.score || 0), 0);
              const averageScore = +(totalScore / 3).toFixed(2);
              await QuarterlyEvaluation.create({
                employeeId: empId,
                quarter: req.query.quarter,
                raId: req.user.userId,   // MD's userId — matched by updateQuarterlyRemarks
                averageScore,
                remarks: null,
              });
            }
          }
        }
      }

      // Scope the main fetch to direct reports
      where.employeeId = { [Op.in]: directReportIds };

    } else if (req.user.role === "HRD") {
      if (!req.query.quarter && !req.query.year) return res.status(400).json({ message: "Quarter or year is required for HRD view" });
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
    }

    if (req.query.quarter) where.quarter = req.query.quarter;

    const isAsEmployee = (req.user.role === "RA" || req.user.role === "EMPLOYEE") && req.query.asEmployee === "true";
    const isPlainEmployee = req.user.role === "EMPLOYEE";

    // Always include the employee association.
    // Include the ra association for everyone except plain EMPLOYEE viewing their own evals.
    // Exception: when RA is acting as employee (asEmployee=true) we DO include ra so the
    // frontend can show "Evaluated by: [RA/MD name]".
    const include = [{ model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] }];
    if (!isPlainEmployee || isAsEmployee) {
      include.push({ model: User, as: "ra", attributes: ["id", "name", "employeeCode"] });
    }

    const evaluations = await QuarterlyEvaluation.findAll({ where, include, order: [["createdAt", "DESC"]], offset, limit });
    const totalCount = await QuarterlyEvaluation.count({ where });

    const response = evaluations.map(ev => ({
      id: ev.id,
      // In asEmployee mode the logged-in RA IS the employee — omit redundant self-reference
      employee: isAsEmployee ? null : ev.employee,
      ra: ev.ra || null,            // who gave the evaluation (RA or MD)
      quarter: ev.quarter,
      remarks: ev.remarks || null,
      hasRemarks: !!(ev.remarks?.trim()),
      averageScore: excludeScore ? null : parseFloat(ev.averageScore),
    }));

    res.json({ page, limit, totalRecords: totalCount, totalPages: Math.ceil(totalCount / limit), data: response });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quarterly evaluations", error: error.message });
  }
};

/* ─── GET QUARTERLY EVALUATION BY ID ────────────────────────────────────────── */
exports.getQuarterlyEvaluationById = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findByPk(req.params.id, {
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: User, as: "ra", attributes: ["id", "name", "employeeCode"] },
      ],
    });

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });
    if (req.user.role === "RA" && quarterly.ra?.id !== req.user.userId) return res.status(403).json({ message: "Not authorized" });
    if (req.user.role === "EMPLOYEE" && quarterly.employee?.id !== req.user.userId) return res.status(403).json({ message: "Not authorized" });

    const canViewScore = ["RA", "HRD", "MD"].includes(req.user.role);
    res.json({ id: quarterly.id, employee: quarterly.employee, quarter: quarterly.quarter, remarks: quarterly.remarks || null, averageScore: canViewScore ? quarterly.averageScore : null, generatedAt: quarterly.createdAt });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quarterly evaluation", error: error.message });
  }
};

/* ─── RA: EVALUATE YEARLY APPRAISAL REPORT ───────────────────────────────────── */
exports.evaluateYearlyReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { raWorkKRAScore, raAdditionalScore, raPersonalAttributes, raTeamAttributes, raLeadershipAttributes, raRemarks } = req.body;

    const report = await YearlyAppraisalReport.findByPk(id);
    if (!report) return res.status(404).json({ message: "Yearly appraisal report not found" });
    if (["MD_EVALUATED", "COMPLETED"].includes(report.status)) return res.status(400).json({ message: "Cannot modify evaluation; MD has already finalized this report." });

    const total = (Number(raWorkKRAScore) || 0) + (Number(raAdditionalScore) || 0)
      + (Number(raPersonalAttributes) || 0) + (Number(raTeamAttributes) || 0)
      + (Number(raLeadershipAttributes) || 0);

    if (total > 80) return res.status(400).json({ message: "RA total score cannot exceed 80" });

    report.raWorkKRAScore = raWorkKRAScore;
    report.raAdditionalScore = raAdditionalScore;
    report.raPersonalAttributes = raPersonalAttributes;
    report.raTeamAttributes = raTeamAttributes;
    report.raLeadershipAttributes = raLeadershipAttributes;
    report.raTotalScore = total;
    report.raRemarks = raRemarks || null;
    report.raEvaluatedAt = new Date();
    if (report.status === "SUBMITTED") report.status = "RA_EVALUATED";
    await report.save();

    await AuditLog.create({ userId: req.user.userId, action: "RA_EVALUATE", entityType: "YEARLY_APPRAISAL_REPORT", entityId: String(report.id), ipAddress: req.ip });
    res.json({ message: "RA evaluation submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ─── YEARLY PLANS & REPORTS (RA VIEW) ──────────────────────────────────────── */
exports.getYearlyPlans = async (req, res) => {
  try {
    const myEmps = await User.findAll({ where: { reportingAuthorityId: req.user.userId }, attributes: ["id"] });
    const myEmpIds = myEmps.map(e => e.id);

    // Guard: Op.in([]) → invalid SQL in PostgreSQL
    if (myEmpIds.length === 0) return res.json([]);

    // FIX: exclude DRAFT plans — RA should only see plans the employee has submitted.
    // A DRAFT plan is private to the employee until they explicitly hit "Submit".
    const where = {
      employeeId: { [Op.in]: myEmpIds },
      status: { [Op.ne]: "DRAFT" },   // ← exclude drafts
    };
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

exports.getYearlyReports = async (req, res) => {
  try {
    const myEmps = await User.findAll({ where: { reportingAuthorityId: req.user.userId }, attributes: ["id"] });
    const myEmpIds = myEmps.map(e => e.id);

    // Guard: Op.in([]) → invalid SQL in PostgreSQL
    if (myEmpIds.length === 0) return res.json([]);

    // FIX: exclude DRAFT appraisal reports — only show submitted reports to RA.
    const where = {
      employeeId: { [Op.in]: myEmpIds },
      status: { [Op.ne]: "DRAFT" },   // ← exclude drafts
    };
    if (req.query.financialYear) where.financialYear = req.query.financialYear;

    const reports = await YearlyAppraisalReport.findAll({
      where,
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        {
          model: YearlyPlan, as: "linkedYearlyPlan",
          attributes: ["id", "financialYear", "version", "status", "submittedAt", "mdRemarks"],
          include: [{ model: YearlyPlanKra, as: "kras", order: [["kraIndex", "ASC"]] }],
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

/* ─── GET QUARTERLY FULL DETAIL ─────────────────────────────────────────────── */
// CHANGE 13: planItems / planAchievements now fetched via Sequelize includes
exports.getQuarterlyFullDetail = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findByPk(req.params.id, {
      include: [
        { model: User, as: "employee", attributes: ["id", "name", "employeeCode", "department"] },
        { model: User, as: "ra", attributes: ["id", "name", "employeeCode"] },
      ],
    });

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });
    if (req.user.role === "RA" && quarterly.ra?.id !== req.user.userId) return res.status(403).json({ message: "Not authorized" });

    const quarterMonths = getQuarterMonths(quarterly.quarter);
    // NOTE: do NOT filter by raId here.
    //  For MD-generated quarterly evals, quarterly.raId = MD's userId, but the
    //  MonthlyEvaluation records retain their original raId (the RA who was set
    //  when the record was first created). Filtering by raId would return 0 rows.
    //  The correct key is (employeeId, month) — at most one EVALUATED record per
    //  employee per month due to the unique monthlyPlanId constraint.
    const allMonthlyEvals = await MonthlyEvaluation.findAll({
      where: { employeeId: quarterly.employeeId, month: { [Op.in]: quarterMonths }, status: "EVALUATED" },
      include: [
        {
          model: MonthlyPlan, as: "monthlyPlan",
          include: [{ model: MonthlyPlanItem, as: "planItems", order: [["itemOrder", "ASC"]] }],
        },
      ],
      order: [["month", "ASC"]],
    });
    // Deduplicate: keep one EVALUATED record per month (defensive against edge cases
    // such as multiple RAs having evaluated the same employee in the same month).
    const seenMonths = new Set();
    const monthlyEvals = allMonthlyEvals.filter(ev => {
      if (seenMonths.has(ev.month)) return false;
      seenMonths.add(ev.month);
      return true;
    });

    const monthlyData = await Promise.all(
      monthlyEvals.map(async (ev) => {
        const planDoc = ev.monthlyPlan || null;

        // CHANGE 13: find achievement with planAchievements via include
        const achievement = planDoc
          ? await MonthlyAchievement.findOne({
            where: { monthlyPlanId: planDoc.id, status: "SUBMITTED" },
            include: [{ model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] }],
          }) || await MonthlyAchievement.findOne({
            where: { monthlyPlanId: planDoc.id },
            include: [{ model: MonthlyAchievementItem, as: "planAchievements", order: [["planIndex", "ASC"]] }],
          })
          : null;

        return {
          month: ev.month, score: ev.score, remarks: ev.remarks || null, evaluatedAt: ev.evaluatedAt,
          plan: planDoc ? { id: planDoc.id, planItems: planDoc.planItems || [], planDetails: planDoc.planDetails || "", submittedAt: planDoc.submittedAt, status: planDoc.status } : null,
          achievement: achievement ? { id: achievement.id, planAchievements: achievement.planAchievements || [], additionalAchievement: achievement.additionalAchievement || "", achievementDetails: achievement.achievementDetails || "", submittedAt: achievement.submittedAt, status: achievement.status } : null,
        };
      })
    );

    // BUG FIX: always recompute average from the live monthly evaluations fetched above.
    // The stored quarterly.averageScore can be 0 or null when the record was auto-generated
    // before the RA finished evaluating all months and was never subsequently corrected.
    // Computing here gives us the ground-truth value every time this endpoint is called.
    const recomputedAvg = monthlyData.length > 0
      ? +(monthlyData.reduce((sum, m) => sum + Number(m.score || 0), 0) / monthlyData.length).toFixed(2)
      : 0;

    // Persist the corrected value so the list view (getQuarterlyEvaluations) stays in sync
    const storedAvg = parseFloat(quarterly.averageScore);
    if (recomputedAvg > 0 && (isNaN(storedAvg) || storedAvg === 0 || Math.abs(storedAvg - recomputedAvg) > 0.005)) {
      await quarterly.update({ averageScore: recomputedAvg });
    }

    res.json({
      id: quarterly.id, employee: quarterly.employee, quarter: quarterly.quarter,
      averageScore: recomputedAvg > 0 ? recomputedAvg : (parseFloat(quarterly.averageScore) || 0),
      remarks: quarterly.remarks || null,
      hasRemarks: !!(quarterly.remarks?.trim()), generatedAt: quarterly.createdAt, monthlyData,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch full quarterly detail", error: error.message });
  }
};

/* ─── RA: REJECT MONTHLY PLAN ───────────────────────────────────────────────── */
exports.rejectMonthlyPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { raRemarks } = req.body;
    const raId = req.user.userId;

    if (!raRemarks || raRemarks.trim().length < 10) return res.status(400).json({ message: "Rejection reason (raRemarks) is required and must be at least 10 characters." });

    const plan = await MonthlyPlan.findByPk(id);
    if (!plan) return res.status(404).json({ message: "Monthly plan not found." });

    const myEmployees = await User.findAll({ where: { reportingAuthorityId: raId }, attributes: ["id"] });
    const myEmpIds = myEmployees.map(e => String(e.id));

    if (!myEmpIds.includes(String(plan.employeeId))) return res.status(403).json({ message: "You are not authorized to reject this plan." });
    if (plan.status === "DRAFT") return res.status(400).json({ message: "Cannot reject a plan that is still in DRAFT status." });
    if (plan.status === "REJECTED") return res.status(400).json({ message: "This plan is already rejected." });
    if (plan.status === "APPROVED") return res.status(400).json({ message: "Cannot reject an already approved plan." });

    const existingEvaluation = await MonthlyEvaluation.findOne({
      where: { employeeId: plan.employeeId, month: plan.month, raId, status: "EVALUATED" },
    });
    if (existingEvaluation) return res.status(400).json({ message: "Cannot reject: you have already submitted an evaluation for this employee's plan this month." });

    plan.status = "REJECTED";
    plan.raRemarks = raRemarks.trim();
    await plan.save();

    await AuditLog.create({ userId: raId, action: "RA_REJECT", entityType: "MONTHLY_PLAN", entityId: String(plan.id), ipAddress: req.ip });

    await Notification.create({
      userId: plan.employeeId, type: "MONTHLY_PLAN_REJECTED",
      title: "Monthly Plan Rejected by RA",
      message: `Your monthly plan for ${plan.month} has been rejected by your Reporting Authority. Reason: "${raRemarks.trim()}". Please revise and resubmit.`,
      entityType: "MONTHLY_PLAN", entityId: String(plan.id),
    });

    res.json({ message: "Monthly plan rejected successfully." });
  } catch (error) {
    res.status(500).json({ message: "Failed to reject monthly plan", error: error.message });
  }
};

/* ─── RA: EXTEND DEADLINE ────────────────────────────────────────────────────── */
exports.extendDeadline = async (req, res) => {
  try {
    const raId = req.user.userId;
    const { employeeId, month, year, type, newDeadline, reason, notifyEmployee } = req.body;

    if (!employeeId || !month || !year || !type || !newDeadline || !reason) return res.status(400).json({ message: "Missing required fields." });
    if (!["plan", "achievement"].includes(type)) return res.status(400).json({ message: "type must be 'plan' or 'achievement'" });
    if (reason.trim().length < 10) return res.status(400).json({ message: "Reason must be at least 10 characters" });

    const employee = await User.findOne({ where: { id: employeeId, reportingAuthorityId: raId } });
    if (!employee) return res.status(403).json({ message: "Employee not found under your authority" });

    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    const extendedDeadlineDate = new Date(newDeadline);
    if (extendedDeadlineDate < new Date()) return res.status(400).json({ message: "New deadline cannot be in the past" });

    await AuditLog.create({ userId: raId, action: "EXTEND_DEADLINE", entityType: "MONTHLY_PLAN", entityId: String(employeeId), ipAddress: req.ip });

    if (notifyEmployee) {
      const typeLabel = type === "plan" ? "Monthly Plan" : "Achievement";
      await Notification.create({
        userId: employeeId, type: "GENERAL",
        title: `${typeLabel} Deadline Extended`,
        message: `Your Reporting Authority has extended your ${typeLabel} submission deadline for ${monthStr} to ${extendedDeadlineDate.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}. Reason: "${reason.trim()}"`,
        entityType: "MONTHLY_PLAN", entityId: String(employeeId),
      });
    }

    res.json({ message: `Deadline extended successfully for ${employee.name}.`, employee: { id: employee.id, name: employee.name }, newDeadline: extendedDeadlineDate.toISOString(), type, month: monthStr });
  } catch (error) {
    res.status(500).json({ message: "Failed to extend deadline", error: error.message });
  }
};