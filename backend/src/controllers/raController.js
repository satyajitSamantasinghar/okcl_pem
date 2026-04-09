const MonthlyEvaluation = require("../models/MonthlyEvaluation");
const QuarterlyEvaluation = require("../models/QuarterlyEvaluation");
const MonthlyAchievement = require("../models/MonthlyAchievement");
const MonthlyPlan = require("../models/MonthlyPlan");
const YearlyPlan = require("../models/YearlyPlan");
const YearlyAppraisalReport = require("../models/YearlyAppraisalReport");
const AuditLog = require("../models/AuditLog");

/* =====================================================
   1. RA DASHBOARD
===================================================== */
exports.getRADashboard = async (req, res) => {
  try {
    const raId = req.user.userId;
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ message: "Month is required" });
    }

    const User = require("../models/User");
    const employees = await User.find({ reportingAuthorityId: raId }).select("_id");
    const employeeIds = employees.map(emp => emp._id);

    const totalEmployees = employeeIds.length;

    const submittedPlans = await MonthlyPlan.find({
      employeeId: { $in: employeeIds },
      month
    }).select("employeeId _id");

    const plansSubmittedThisMonth = submittedPlans.length;
    const planIds = submittedPlans.map(p => p._id);
    const submittedEmployeeIds = submittedPlans.map(p => p.employeeId);

    const achievements = await MonthlyAchievement.find({
      monthlyPlanId: { $in: planIds }
    }).populate("monthlyPlanId", "employeeId");

    const achievementsThisMonth = achievements.length;
    const achievementEmployeeIds = achievements.map(a => a.monthlyPlanId?.employeeId).filter(Boolean);

    const evaluated = await MonthlyEvaluation.find({
      employeeId: { $in: employeeIds },
      month,
      raId,
      status: "EVALUATED"
    }).select("employeeId");

    const evaluatedThisMonth = evaluated.length;
    const evaluatedEmployeeIds = evaluated.map(e => e.employeeId);

    const pendingEvaluation = await MonthlyEvaluation.countDocuments({
      employeeId: { $in: employeeIds },
      month,
      raId,
      status: "PENDING"
    });

    const employeesWithPlansStr = submittedEmployeeIds.map(id => id.toString());
    const notSubmittedEmployeeIds = employeeIds.filter(id => !employeesWithPlansStr.includes(id.toString()));
    const notYetSubmitted = notSubmittedEmployeeIds.length;

    const pendingYearly = await YearlyAppraisalReport.countDocuments({
      employeeId: { $in: employeeIds },
      status: "SUBMITTED"
    });

    /* ─── NEW: Quarterly evaluations that have scores but no remarks ─── */
    const pendingQuarterlyRemarks = await QuarterlyEvaluation.countDocuments({
      raId,
      $or: [
        { remarks: null },
        { remarks: "" },
        { remarks: { $exists: false } }
      ]
    });

    res.json({
      totalEmployees,
      plansSubmittedThisMonth,
      achievementsThisMonth,
      evaluatedThisMonth,
      pendingEvaluation,
      notYetSubmitted,
      pendingYearly,
      pendingQuarterlyRemarks,          /* ← NEW field */
      lists: {
        submitted: submittedEmployeeIds,
        achievements: achievementEmployeeIds,
        evaluated: evaluatedEmployeeIds,
        notSubmitted: notSubmittedEmployeeIds
      }
    });

  } catch (error) {
    res.status(500).json({ message: "Failed to load RA dashboard", error: error.message });
  }
};

/* =====================================================
   NEW: GET MONTHLY TREND — last 6 months
   Route to add in your routes file:
     router.get('/monthly-trend', authenticate, authorize('RA'), raController.getMonthlyTrend);
===================================================== */
exports.getMonthlyTrend = async (req, res) => {
  try {
    const raId = req.user.userId;
    const User = require("../models/User");

    const employees = await User.find({ reportingAuthorityId: raId }).select("_id");
    const employeeIds = employees.map(emp => emp._id);

    /* Build the last 6 calendar months */
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const trendData = await Promise.all(
      months.map(async (monthStr) => {
        /* Plans submitted this month */
        const monthPlans = await MonthlyPlan.find({
          employeeId: { $in: employeeIds },
          month: monthStr
        }).select("_id");

        const planIds = monthPlans.map(p => p._id);

        const [achievements, evaluations] = await Promise.all([
          /* Achievements linked to plans of this month */
          MonthlyAchievement.countDocuments({ monthlyPlanId: { $in: planIds } }),
          /* RA evaluations completed this month */
          MonthlyEvaluation.countDocuments({
            employeeId: { $in: employeeIds },
            month: monthStr,
            raId,
            status: "EVALUATED"
          })
        ]);

        const [year, mon] = monthStr.split("-");
        const shortMonth = new Date(parseInt(year), parseInt(mon) - 1)
          .toLocaleDateString("en-US", { month: "short" });

        return {
          month: monthStr,
          shortMonth,
          plans: monthPlans.length,
          achievements,
          evaluations
        };
      })
    );

    res.json(trendData);
  } catch (error) {
    res.status(500).json({ message: "Failed to load monthly trend", error: error.message });
  }
};

/* =====================================================
   GET EMPLOYEES UNDER RA
===================================================== */
exports.getMyEmployees = async (req, res) => {
  try {
    const raId = req.user.userId;
    const User = require("../models/User");

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const employees = await User.find({
      reportingAuthorityId: raId,
      isActive: true
    }).select("name employeeCode department email createdAt");

    const result = await Promise.all(
      employees.map(async (emp) => {
        const [
          totalPlans, totalEvaluated, totalAchievements,
          currentMonthPlan, currentMonthAchievement, currentMonthEvaluation
        ] = await Promise.all([
          MonthlyPlan.countDocuments({ employeeId: emp._id }),
          MonthlyEvaluation.countDocuments({ employeeId: emp._id, raId, status: "EVALUATED" }),
          MonthlyAchievement.countDocuments({ employeeId: emp._id }),
          MonthlyPlan.findOne({ employeeId: emp._id, month: currentMonth, status: { $ne: "DRAFT" } }).select("_id").lean(),
          MonthlyAchievement.findOne({ employeeId: emp._id, month: currentMonth }).select("_id").lean(),
          MonthlyEvaluation.findOne({ employeeId: emp._id, raId, month: currentMonth, status: "EVALUATED" }).select("_id").lean()
        ]);

        return {
          _id: emp._id,
          name: emp.name,
          employeeCode: emp.employeeCode,
          department: emp.department,
          email: emp.email,
          joinedAt: emp.createdAt,
          totalPlans,
          totalEvaluated,
          totalAchievements,
          currentMonth,
          currentMonthPlanSubmitted: !!currentMonthPlan,
          currentMonthAchievementSubmitted: !!currentMonthAchievement,
          currentMonthEvaluated: !!currentMonthEvaluation
        };
      })
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch employees", error: error.message });
  }
};

/* =====================================================
   GET EMPLOYEE DETAIL FOR RA
===================================================== */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const raId = req.user.userId;
    const User = require("../models/User");

    const employee = await User.findById(id, "name employeeCode department role reportingAuthorityId isActive email createdAt")
      .populate("reportingAuthorityId", "name");

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.reportingAuthorityId._id.toString() !== raId) {
      return res.status(403).json({ message: "You are not authorized to view this employee's details" });
    }

    const [monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports] = await Promise.all([
      MonthlyPlan.find({ employeeId: id }).sort({ month: -1 }),
      MonthlyAchievement.find({ employeeId: id }).populate("monthlyPlanId", "month planDetails").sort({ submittedAt: -1 }),
      MonthlyEvaluation.find({ employeeId: id }).populate("raId", "name").sort({ month: -1 }),
      QuarterlyEvaluation.find({ employeeId: id }).populate("raId", "name").sort({ createdAt: -1 }),
      YearlyPlan.find({ employeeId: id }).sort({ submittedAt: -1 }),
      YearlyAppraisalReport.find({ employeeId: id }).sort({ submittedAt: -1 })
    ]);

    res.json({ employee, monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   2. SUBMIT MONTHLY EVALUATION
===================================================== */
exports.submitMonthlyEvaluation = async (req, res) => {
  try {
    const { evaluationId, score, remarks } = req.body;

    if (req.user.role !== "RA") {
      return res.status(403).json({ message: "Only Reporting Authority can evaluate" });
    }

    const evaluation = await MonthlyEvaluation.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({ message: "Evaluation not found" });
    }

    if (evaluation.status === "EVALUATED") {
      return res.status(400).json({ message: "Evaluation already submitted" });
    }

    evaluation.score = score;
    evaluation.remarks = remarks;
    evaluation.status = "EVALUATED";
    evaluation.evaluatedAt = new Date();

    await evaluation.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "EVALUATE",
      entityType: "MONTHLY_EVALUATION",
      entityId: evaluation._id,
      ipAddress: req.ip
    });

    res.json({ message: "Monthly evaluation submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit evaluation", error: error.message });
  }
};

/* =====================================================
   3. GET MONTHLY EVALUATIONS
===================================================== */
exports.getMonthlyEvaluations = async (req, res) => {
  try {
    let filter = {};
    let projection = {};

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
      projection = { score: 0, raId: 0 };
    } else if (req.user.role === "RA") {
      filter.raId = req.user.userId;

      if (req.query.month) {
        const User = require("../models/User");
        const myEmps = await User.find({ reportingAuthorityId: req.user.userId }).select("_id");
        const myEmpIds = myEmps.map(e => e._id);

        const plans = await MonthlyPlan.find({ employeeId: { $in: myEmpIds }, month: req.query.month });

        for (const plan of plans) {
          const exists = await MonthlyEvaluation.findOne({
            employeeId: plan.employeeId,
            month: plan.month,
            raId: req.user.userId
          });
          if (!exists) {
            await MonthlyEvaluation.create({
              employeeId: plan.employeeId,
              monthlyPlanId: plan._id,
              raId: req.user.userId,
              month: plan.month,
              score: 0,
              remarks: ""
            });
          }
        }
      }
    } else if (req.user.role === "HRD" || req.user.role === "MD") {
      if (!req.query.month && !req.query.year) {
        return res.status(400).json({ message: "Month or year is required for HRD/MD view" });
      }
      if (req.query.employeeId) filter.employeeId = req.query.employeeId;
    }

    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = req.query.year;

    const evaluations = await MonthlyEvaluation.find(filter, projection)
      .populate("employeeId", "name employeeCode department")
      .populate("monthlyPlanId", "month planDetails planItems")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await MonthlyEvaluation.countDocuments(filter);

    const planIds = evaluations.map(ev => ev.monthlyPlanId?._id).filter(Boolean);
    const achievements = await MonthlyAchievement.find({ monthlyPlanId: { $in: planIds } }).select("monthlyPlanId");
    const achSet = new Set(achievements.map(a => a.monthlyPlanId.toString()));

    const response = evaluations.map(ev => ({
      _id: ev._id,
      employee: ev.employeeId,
      month: ev.month,
      remarks: ev.remarks || null,
      score: req.user.role === "EMPLOYEE" ? null : ev.score,
      status: ev.status,
      monthlyPlanId: ev.monthlyPlanId,
      hasAchievement: ev.monthlyPlanId ? achSet.has(ev.monthlyPlanId._id.toString()) : false
    }));

    res.json({ page, limit, totalRecords: totalCount, totalPages: Math.ceil(totalCount / limit), data: response });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly evaluations", error: error.message });
  }
};

/* =====================================================
   4. GET MONTHLY EVALUATION BY ID
===================================================== */
exports.getMonthlyEvaluationById = async (req, res) => {
  try {
    const evaluation = await MonthlyEvaluation.findById(req.params.id)
      .populate("employeeId", "name employeeCode department")
      .populate("monthlyPlanId")
      .populate("raId", "name employeeCode");

    if (!evaluation) {
      return res.status(404).json({ message: "Monthly evaluation not found" });
    }

    if (req.user.role === "RA" && evaluation.raId._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "You are not authorized to view this evaluation" });
    }

    if (req.user.role === "EMPLOYEE" && evaluation.employeeId._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "You are not authorized to view this evaluation" });
    }

    const achievement = await MonthlyAchievement.findOne({ monthlyPlanId: evaluation.monthlyPlanId._id });
    const canViewScore = req.user.role === "RA" || req.user.role === "HRD" || req.user.role === "MD";

    res.json({
      plan: evaluation.monthlyPlanId,
      achievement: achievement || null,
      remarks: evaluation.remarks || null,
      score: canViewScore ? evaluation.score : null,
      status: {
        planSubmitted: true,
        achievementSubmitted: !!achievement,
        evaluated: evaluation.status === "EVALUATED"
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly evaluation", error: error.message });
  }
};

/* =====================================================
   5. AUTO-GENERATE QUARTERLY EVALUATIONS
===================================================== */
exports.generateQuarterlyEvaluation = async (req, res) => {
  try {
    const { quarter, remarks } = req.body;
    const raId = req.user.userId;

    if (req.user.role !== "RA") {
      return res.status(403).json({ message: "Only Reporting Authority can generate quarterly evaluation" });
    }

    if (!quarter) {
      return res.status(400).json({ message: "quarter is required (e.g. Q1-2026)" });
    }

    const quarterMonths = getQuarterMonths(quarter);
    if (!quarterMonths) {
      return res.status(400).json({ message: "Invalid quarter format. Use Q1-2026, Q2-2026, etc." });
    }

    const User = require("../models/User");
    const myEmployees = await User.find({ reportingAuthorityId: raId }).select("_id");
    const myEmpIds = myEmployees.map(e => e._id);

    let generated = 0;
    let skipped = 0;
    const results = [];

    for (const empId of myEmpIds) {
      const existing = await QuarterlyEvaluation.findOne({ employeeId: empId, quarter });
      if (existing) { skipped++; continue; }

      const evals = await MonthlyEvaluation.find({
        employeeId: empId,
        raId,
        month: { $in: quarterMonths },
        status: "EVALUATED"
      });

      if (evals.length === 3) {
        const totalScore = evals.reduce((sum, ev) => sum + ev.score, 0);
        const averageScore = +(totalScore / 3).toFixed(2);

        const quarterly = await QuarterlyEvaluation.create({
          employeeId: empId,
          quarter,
          raId,
          averageScore,
          remarks: remarks || null
        });

        await AuditLog.create({
          userId: raId,
          action: "GENERATE",
          entityType: "QUARTERLY_EVALUATION",
          entityId: quarterly._id,
          ipAddress: req.ip
        });

        generated++;
        results.push({ employeeId: empId, averageScore });
      }
    }

    res.json({
      message: `Quarterly evaluations generated: ${generated}, skipped (already exist): ${skipped}`,
      generated, skipped, results
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate quarterly evaluation", error: error.message });
  }
};

function getQuarterMonths(quarter) {
  const match = quarter.match(/^Q(\d)-(\d{4})$/);
  if (!match) return null;
  const q = parseInt(match[1]);
  const year = match[2];
  const monthMap = { 1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"] };
  if (!monthMap[q]) return null;
  return monthMap[q].map(m => `${year}-${m}`);
}

/* =====================================================
   5b. GET QUARTERLY DETAIL
===================================================== */
exports.getQuarterlyDetail = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findById(req.params.id)
      .populate("employeeId", "name employeeCode department")
      .populate("raId", "name employeeCode");

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });

    if (req.user.role === "RA" && quarterly.raId._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const quarterMonths = getQuarterMonths(quarterly.quarter);
    const monthlyEvals = await MonthlyEvaluation.find({
      employeeId: quarterly.employeeId._id,
      raId: quarterly.raId._id,
      month: { $in: quarterMonths },
      status: "EVALUATED"
    }).sort({ month: 1 });

    res.json({
      _id: quarterly._id,
      employee: quarterly.employeeId,
      quarter: quarterly.quarter,
      averageScore: quarterly.averageScore,
      remarks: quarterly.remarks,
      generatedAt: quarterly.createdAt,
      monthlyBreakdown: monthlyEvals.map(ev => ({
        month: ev.month, score: ev.score, remarks: ev.remarks, evaluatedAt: ev.evaluatedAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quarterly detail", error: error.message });
  }
};

/* =====================================================
   5c. UPDATE QUARTERLY REMARKS
===================================================== */
exports.updateQuarterlyRemarks = async (req, res) => {
  try {
    const { remarks } = req.body;
    const quarterly = await QuarterlyEvaluation.findById(req.params.id);

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });

    if (quarterly.raId.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    quarterly.remarks = remarks;
    await quarterly.save();
    res.json({ message: "Remarks updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update remarks", error: error.message });
  }
};

/* =====================================================
   GET QUARTERLY EVALUATIONS
===================================================== */
exports.getQuarterlyEvaluations = async (req, res) => {
  try {
    let filter = {};
    let projection = {};

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
      projection = { averageScore: 0, raId: 0 };
    } else if (req.user.role === "RA") {
      filter.raId = req.user.userId;

      if (req.query.quarter) {
        const quarterMonths = getQuarterMonths(req.query.quarter);
        if (quarterMonths) {
          const User = require("../models/User");
          const myEmps = await User.find({ reportingAuthorityId: req.user.userId }).select("_id");
          const myEmpIds = myEmps.map(e => e._id);

          for (const empId of myEmpIds) {
            const existing = await QuarterlyEvaluation.findOne({ employeeId: empId, quarter: req.query.quarter });
            if (existing) continue;

            const evals = await MonthlyEvaluation.find({
              employeeId: empId, raId: req.user.userId,
              month: { $in: quarterMonths }, status: "EVALUATED"
            });

            if (evals.length === 3) {
              const totalScore = evals.reduce((sum, ev) => sum + ev.score, 0);
              const averageScore = +(totalScore / 3).toFixed(2);
              await QuarterlyEvaluation.create({
                employeeId: empId, quarter: req.query.quarter,
                raId: req.user.userId, averageScore, remarks: null
              });
            }
          }
        }
      }
    } else if (req.user.role === "HRD" || req.user.role === "MD") {
      if (!req.query.quarter && !req.query.year) {
        return res.status(400).json({ message: "Quarter or year is required for HRD/MD view" });
      }
      if (req.query.employeeId) filter.employeeId = req.query.employeeId;
    }

    if (req.query.quarter) filter.quarter = req.query.quarter;
    if (req.query.year) filter.year = req.query.year;

    let query = QuarterlyEvaluation.find(filter, projection)
      .populate("employeeId", "name employeeCode department");

    if (req.user.role !== "EMPLOYEE") {
      query = query.populate("raId", "name employeeCode");
    }

    const evaluations = await query.sort({ createdAt: -1 }).skip(skip).limit(limit);
    const totalCount = await QuarterlyEvaluation.countDocuments(filter);

    const response = evaluations.map(ev => ({
      _id: ev._id,
      employee: ev.employeeId,
      quarter: ev.quarter,
      remarks: ev.remarks || null,
      hasRemarks: !!(ev.remarks && ev.remarks.trim()),
      averageScore: req.user.role === "EMPLOYEE" ? null : ev.averageScore
    }));

    res.json({ page, limit, totalRecords: totalCount, totalPages: Math.ceil(totalCount / limit), data: response });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quarterly evaluations", error: error.message });
  }
};

exports.getQuarterlyEvaluationById = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findById(req.params.id)
      .populate("employeeId", "name employeeCode department")
      .populate("raId", "name employeeCode");

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });

    if (req.user.role === "RA" && quarterly.raId._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "You are not authorized to view this quarterly evaluation" });
    }

    if (req.user.role === "EMPLOYEE" && quarterly.employeeId._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "You are not authorized to view this quarterly evaluation" });
    }

    const canViewScore = req.user.role === "RA" || req.user.role === "HRD" || req.user.role === "MD";

    res.json({
      _id: quarterly._id,
      employee: quarterly.employeeId,
      quarter: quarterly.quarter,
      remarks: quarterly.remarks || null,
      averageScore: canViewScore ? quarterly.averageScore : null,
      generatedAt: quarterly.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch quarterly evaluation", error: error.message });
  }
};

/* =====================================================
   RA: EVALUATE YEARLY APPRAISAL REPORT
===================================================== */
exports.evaluateYearlyReport = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      raWorkKRAScore, raAdditionalScore,
      raPersonalAttributes, raTeamAttributes, raLeadershipAttributes,
      raRemarks
    } = req.body;

    const report = await YearlyAppraisalReport.findById(id);
    if (!report) return res.status(404).json({ message: "Yearly appraisal report not found" });

    if (["MD_EVALUATED", "COMPLETED"].includes(report.status)) {
      return res.status(400).json({ message: "Cannot modify evaluation; MD has already finalized this report." });
    }

    const total = (Number(raWorkKRAScore) || 0)
      + (Number(raAdditionalScore) || 0)
      + (Number(raPersonalAttributes) || 0)
      + (Number(raTeamAttributes) || 0)
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

    await AuditLog.create({
      userId: req.user.userId, action: "RA_EVALUATE",
      entityType: "YEARLY_APPRAISAL_REPORT", entityId: report._id, ipAddress: req.ip
    });

    res.json({ message: "RA evaluation submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   GET YEARLY PLANS & REPORTS (RA VIEW)
===================================================== */
exports.getYearlyPlans = async (req, res) => {
  try {
    const User = require("../models/User");
    const myEmps = await User.find({ reportingAuthorityId: req.user.userId }).select("_id");
    const myEmpIds = myEmps.map(e => e._id);

    let filter = { employeeId: { $in: myEmpIds } };
    if (req.query.financialYear) filter.financialYear = req.query.financialYear;

    const plans = await YearlyPlan.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ submittedAt: -1 });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getYearlyReports = async (req, res) => {
  try {
    const User = require("../models/User");
    const myEmps = await User.find({ reportingAuthorityId: req.user.userId }).select("_id");
    const myEmpIds = myEmps.map(e => e._id);

    let filter = { employeeId: { $in: myEmpIds } };
    if (req.query.financialYear) filter.financialYear = req.query.financialYear;

    const reports = await YearlyAppraisalReport.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ submittedAt: -1 });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getQuarterlyFullDetail = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findById(req.params.id)
      .populate("employeeId", "name employeeCode department")
      .populate("raId", "name employeeCode");

    if (!quarterly) return res.status(404).json({ message: "Quarterly evaluation not found" });

    if (req.user.role === "RA" && quarterly.raId._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const quarterMonths = getQuarterMonths(quarterly.quarter);
    const monthlyEvals = await MonthlyEvaluation.find({
      employeeId: quarterly.employeeId._id,
      raId: quarterly.raId._id,
      month: { $in: quarterMonths },
      status: "EVALUATED"
    }).populate("monthlyPlanId").sort({ month: 1 });

    const monthlyData = await Promise.all(
      monthlyEvals.map(async (ev) => {
        const planDoc = ev.monthlyPlanId;
        const achievement = planDoc
          ? await MonthlyAchievement.findOne({ monthlyPlanId: planDoc._id, status: "SUBMITTED" }).lean()
          : null;
        const achievementFallback = !achievement && planDoc
          ? await MonthlyAchievement.findOne({ monthlyPlanId: planDoc._id }).lean()
          : null;
        const achData = achievement || achievementFallback;

        return {
          month: ev.month, score: ev.score,
          remarks: ev.remarks || null, evaluatedAt: ev.evaluatedAt,
          plan: planDoc ? {
            _id: planDoc._id, planItems: planDoc.planItems || [],
            planDetails: planDoc.planDetails || "", submittedAt: planDoc.submittedAt, status: planDoc.status
          } : null,
          achievement: achData ? {
            _id: achData._id, planAchievements: achData.planAchievements || [],
            additionalAchievement: achData.additionalAchievement || "",
            achievementDetails: achData.achievementDetails || "",
            submittedAt: achData.submittedAt, status: achData.status
          } : null
        };
      })
    );

    res.json({
      _id: quarterly._id, employee: quarterly.employeeId,
      quarter: quarterly.quarter, averageScore: quarterly.averageScore,
      remarks: quarterly.remarks || null,
      hasRemarks: !!(quarterly.remarks && quarterly.remarks.trim()),
      generatedAt: quarterly.createdAt, monthlyData
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch full quarterly detail", error: error.message });
  }
};