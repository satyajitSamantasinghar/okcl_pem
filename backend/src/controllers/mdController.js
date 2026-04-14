const YearlyAppraisal = require("../models/YearlyAppraisal");
const YearlyPlan = require("../models/YearlyPlan");
const YearlyAppraisalReport = require("../models/YearlyAppraisalReport");
const MonthlyPlan = require("../models/MonthlyPlan");
const MonthlyAchievement = require("../models/MonthlyAchievement");
const MonthlyEvaluation = require("../models/MonthlyEvaluation");
const QuarterlyEvaluation = require("../models/QuarterlyEvaluation");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");

/* =====================================================
   MD DASHBOARD — KPI Stats
===================================================== */
exports.getMDDashboard = async (req, res) => {
  try {
    const month = req.query.month || (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    })();

    const currentYear = new Date().getFullYear();
    const fy = new Date().getMonth() >= 3
      ? `${currentYear}-${String(currentYear + 1).slice(2)}`
      : `${currentYear - 1}-${String(currentYear).slice(2)}`;

    const [
      totalEmployees,
      totalRAs,
      monthlyPlansSubmitted,
      monthlyAchievementsSubmitted,
      yearlyPlansTotal,
      yearlyPlansPending,
      yearlyReportsTotal,
      todayAuditCount
    ] = await Promise.all([
      User.countDocuments({ role: "EMPLOYEE" }),
      User.countDocuments({ role: "RA" }),
      MonthlyPlan.countDocuments({ month }),
      MonthlyAchievement.countDocuments({}).then(async () => {
        const plans = await MonthlyPlan.find({ month }, "_id");
        const planIds = plans.map(p => p._id);
        return MonthlyAchievement.countDocuments({ monthlyPlanId: { $in: planIds } });
      }),
      YearlyPlan.countDocuments({ financialYear: fy }),
      YearlyPlan.countDocuments({ financialYear: fy, status: "PENDING" }),
      YearlyAppraisalReport.countDocuments({ financialYear: fy }),
      AuditLog.countDocuments({
        timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      })
    ]);

    const monthlyPlansPending = totalEmployees - monthlyPlansSubmitted;
    const monthlyAchievementsPending = monthlyPlansSubmitted - monthlyAchievementsSubmitted;

    res.json({
      totalEmployees,
      totalRAs,
      monthlyPlansSubmitted,
      monthlyPlansPending: Math.max(0, monthlyPlansPending),
      monthlyAchievementsSubmitted,
      monthlyAchievementsPending: Math.max(0, monthlyAchievementsPending),
      yearlyPlansTotal,
      yearlyPlansPending,
      yearlyReportsTotal,
      todayAuditCount,
      currentMonth: month,
      currentFY: fy
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   AUDIT LOGS — paginated + date filter
===================================================== */
exports.getAuditLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};

    // Date range
    if (req.query.from) {
      filter.timestamp = filter.timestamp || {};
      filter.timestamp.$gte = new Date(req.query.from);
    }
    if (req.query.to) {
      filter.timestamp = filter.timestamp || {};
      filter.timestamp.$lte = new Date(new Date(req.query.to).setHours(23, 59, 59, 999));
    }

    // Entity type filter
    if (req.query.entityType) {
      filter.entityType = req.query.entityType;
    }

    // Action filter
    if (req.query.action) {
      filter.action = req.query.action;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate("userId", "name employeeCode role")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   EMPLOYEE DETAIL — for click-through from dashboard
===================================================== */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await User.findById(id, "name employeeCode department role reportingAuthorityId")
      .populate("reportingAuthorityId", "name");

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Current year months
    const currentYear = new Date().getFullYear();

    const [monthlyPlans, monthlyAchievements, monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports] = await Promise.all([
      MonthlyPlan.find({ employeeId: id }).sort({ month: -1 }),
      MonthlyAchievement.find({ employeeId: id })
        .populate("monthlyPlanId", "month planDetails")
        .sort({ submittedAt: -1 }),
      MonthlyEvaluation.find({ employeeId: id })
        .populate("raId", "name")
        .sort({ month: -1 }),
      QuarterlyEvaluation.find({ employeeId: id })
        .populate("raId", "name")
        .sort({ createdAt: -1 }),
      YearlyPlan.find({ employeeId: id }).sort({ submittedAt: -1 }),
      YearlyAppraisalReport.find({ employeeId: id }).sort({ submittedAt: -1 })
    ]);

    res.json({
      employee,
      monthlyPlans,
      monthlyAchievements,
      monthlyEvaluations,
      quarterlyEvaluations,
      yearlyPlans,
      yearlyReports
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL EMPLOYEES LIST — for dashboard search/grid
===================================================== */
exports.getAllEmployees = async (req, res) => {
  try {
    const filter = { role: { $in: ["EMPLOYEE", "RA"] } };

    if (req.query.q) {
      const regex = new RegExp(req.query.q, "i");
      filter.$or = [{ name: regex }, { employeeCode: regex }];
    }

    let query = User.find(filter, "name employeeCode department role reportingAuthorityId")
      .sort({ name: 1 });
      
    if (req.query.q) {
      query = query.limit(50);
    }
    
    const employees = await query.exec();

    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   REJECT MONTHLY PLAN
===================================================== */
exports.rejectMonthlyPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { mdRemarks } = req.body;

    const plan = await MonthlyPlan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: "Monthly plan not found" });
    }

    // Check if RA already evaluated — cannot reject
    const evaluation = await MonthlyEvaluation.findOne({
      employeeId: plan.employeeId,
      month: plan.month,
      status: "EVALUATED"
    });
    if (evaluation) {
      return res.status(400).json({
        message: "Cannot reject: RA has already evaluated this monthly plan"
      });
    }

    plan.status = "REJECTED";
    plan.mdRemarks = mdRemarks || null;
    await plan.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "REJECT",
      entityType: "MONTHLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    // Create notification for employee
    await Notification.create({
      userId: plan.employeeId,
      type: "MONTHLY_PLAN_REJECTED",
      title: "Monthly Plan Rejected",
      message: `Your monthly plan for ${plan.month} has been rejected by MD.${mdRemarks ? ' Remarks: ' + mdRemarks : ''} Please resubmit.`,
      entityType: "MONTHLY_PLAN",
      entityId: plan._id
    });

    res.json({ message: "Monthly plan rejected" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   MD: APPROVE / REJECT YEARLY PLAN
===================================================== */
exports.approveRejectYearlyPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, mdRemarks } = req.body;

    const plan = await YearlyPlan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: "Yearly plan not found" });
    }

    if (decision === "APPROVE") {
      plan.status = "APPROVED";
    } else if (decision === "REJECT") {
      plan.status = "REJECTED";
    } else {
      return res.status(400).json({ message: "Decision must be APPROVE or REJECT" });
    }

    plan.mdRemarks = mdRemarks || null;
    await plan.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: decision,
      entityType: "YEARLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.json({ message: `Yearly plan ${plan.status.toLowerCase()}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   MD: EVALUATE YEARLY APPRAISAL REPORT
===================================================== */
exports.evaluateYearlyReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { mdFinalScore, mdRemarks } = req.body;

    if (Number(mdFinalScore) > 15) {
      return res.status(400).json({ message: "MD score cannot exceed 15" });
    }

    const report = await YearlyAppraisalReport.findById(id);
    if (!report) {
      return res.status(404).json({ message: "Yearly appraisal report not found" });
    }

    report.mdFinalScore = mdFinalScore;
    report.mdRemarks = mdRemarks || null;
    report.mdEvaluatedAt = new Date();

    // Compute grand total (RA: max 80 + HRD: max 5 + MD: max 15 = 100)
    report.grandTotal = (report.raTotalScore || 0) + (report.hrdTotalScore || 0) + (Number(mdFinalScore) || 0);

    report.status = "COMPLETED";
    await report.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "MD_EVALUATE",
      entityType: "YEARLY_APPRAISAL_REPORT",
      entityId: report._id,
      ipAddress: req.ip
    });

    res.json({ message: "MD evaluation submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   LEGACY: FINAL APPROVAL
===================================================== */
exports.finalApproval = async (req, res) => {
  try {
    const { appraisalId, mdRemarks, mdFinalRating, decision } = req.body;
    const appraisal = await YearlyAppraisal.findById(appraisalId);
    if (!appraisal) {
      return res.status(404).json({ message: "Appraisal not found" });
    }
    appraisal.mdRemarks = mdRemarks;
    appraisal.mdFinalRating = mdFinalRating;
    appraisal.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    await appraisal.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "FINAL_APPROVAL",
      entityType: "YEARLY_APPRAISAL",
      entityId: appraisal._id,
      ipAddress: req.ip
    });

    res.json({ message: `Appraisal ${appraisal.status}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL MONTHLY PLANS — for MD dashboard section
===================================================== */
exports.getMonthlyPlansList = async (req, res) => {
  try {
    const { month, year, status } = req.query;
    const filter = {};
    if (month) {
      filter.month = month;
    } else if (year) {
      filter.month = { $regex: `^${year}` };
    }
    if (status) filter.status = status;

    const plans = await MonthlyPlan.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ month: -1, submittedAt: -1 })
      .limit(100);

    // Attach evaluation status
    const result = await Promise.all(plans.map(async (p) => {
      if (!p.employeeId) return null; // Safe guard for dangling plans where user was deleted
      
      const evaluation = await MonthlyEvaluation.findOne({
        employeeId: p.employeeId._id,
        month: p.month
      });
      const achievement = await MonthlyAchievement.findOne({
        monthlyPlanId: p._id
      });
      return {
        ...p.toObject(),
        evaluationStatus: evaluation?.status || null,
        hasAchievement: !!achievement && achievement.status !== 'DRAFT',
        evaluationScore: evaluation?.score || null,
        evaluationRemarks: evaluation?.remarks || null,
        achievementDetails: achievement?.achievementDetails || null,
        achievementDate: achievement?.submittedAt || null
      };
    }));

    res.json(result.filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL QUARTERLY EVALUATIONS — for MD dashboard section
===================================================== */
exports.getQuarterlyEvalsList = async (req, res) => {
  try {
    const { year } = req.query;
    const filter = {};
    if (year) filter.financialYear = year;

    const evals = await QuarterlyEvaluation.find(filter)
      .populate("employeeId", "name employeeCode department")
      .populate("raId", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(evals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL YEARLY PLANS — for MD dashboard/approvals
===================================================== */
exports.getYearlyPlans = async (req, res) => {
  try {
    let filter = {};
    if (req.query.financialYear) filter.financialYear = req.query.financialYear;

    const plans = await YearlyPlan.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ submittedAt: -1 });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL YEARLY REPORTS — for MD dashboard/approvals
===================================================== */
exports.getYearlyReports = async (req, res) => {
  try {
    let filter = {};
    if (req.query.financialYear) filter.financialYear = req.query.financialYear;

    const reports = await YearlyAppraisalReport.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ submittedAt: -1 });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
