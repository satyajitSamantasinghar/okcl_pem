const YearlyAppraisal = require("../models/YearlyAppraisal");
const YearlyPlan = require("../models/YearlyPlan");
const YearlyAppraisalReport = require("../models/YearlyAppraisalReport");
const QuarterlyEvaluation = require("../models/QuarterlyEvaluation");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const MonthlyPlan = require("../models/MonthlyPlan");
const MonthlyEvaluation = require("../models/MonthlyEvaluation");
const MonthlyAchievement = require("../models/MonthlyAchievement");

/* =====================================================
   HRD DASHBOARD STATS
===================================================== */
exports.getHRDDashboard = async (req, res) => {
  try {
    const month = req.query.month;

    const totalEmployees = await User.countDocuments({ role: "EMPLOYEE", isActive: true });
    const totalRAs = await User.countDocuments({ role: "RA", isActive: true });

    let plansThisMonth = 0;
    let evaluationsThisMonth = 0;
    let pendingEvaluations = 0;

    if (month) {
      plansThisMonth = await MonthlyPlan.countDocuments({ month });
      evaluationsThisMonth = await MonthlyEvaluation.countDocuments({ month, status: "EVALUATED" });
      pendingEvaluations = await MonthlyEvaluation.countDocuments({
        month,
        $or: [{ status: "PENDING" }, { status: { $exists: false } }]
      });
    }

    const totalQuarterly = await QuarterlyEvaluation.countDocuments();

    // Org health score: % of employees evaluated this month
    const orgHealthScore = totalEmployees > 0
      ? Math.round((evaluationsThisMonth / totalEmployees) * 100)
      : 0;

    res.json({
      totalEmployees,
      totalRAs,
      plansThisMonth,
      evaluationsThisMonth,
      pendingEvaluations,
      totalQuarterly,
      orgHealthScore
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dashboard stats", error: error.message });
  }
};

/* =====================================================
   GET ALL RAs WITH EMPLOYEE COUNTS + EVAL PROGRESS
   Enriches each employee with evaluationStatus + lastScore
===================================================== */
exports.getRAList = async (req, res) => {
  try {
    const month = req.query.month;

    const ras = await User.find({ role: "RA", isActive: true })
      .select("name employeeCode department")
      .lean();

    const result = [];

    for (const ra of ras) {
      const employees = await User.find({ reportingAuthorityId: ra._id, isActive: true })
        .select("name employeeCode department")
        .lean();

      let evaluated = 0;
      const total = employees.length;
      let enrichedEmployees = employees;

      if (month && employees.length > 0) {
        const empIds = employees.map(e => e._id);

        const evaluations = await MonthlyEvaluation.find({
          raId: ra._id,
          employeeId: { $in: empIds },
          month
        }).select("employeeId status score").lean();

        const evalMap = {};
        evaluations.forEach(ev => {
          evalMap[ev.employeeId.toString()] = {
            status: ev.status,
            score: ev.score
          };
        });

        evaluated = evaluations.filter(ev => ev.status === "EVALUATED").length;

        enrichedEmployees = employees.map(emp => {
          const ev = evalMap[emp._id.toString()];
          return {
            ...emp,
            evaluationStatus: ev
              ? ev.status === "EVALUATED" ? "evaluated" : "pending"
              : "not_started",
            lastScore: ev && ev.status === "EVALUATED" ? ev.score : null
          };
        });
      }

      result.push({
        _id: ra._id,
        name: ra.name,
        employeeCode: ra.employeeCode,
        department: ra.department,
        employeeCount: total,
        evaluated,
        employees: enrichedEmployees
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch RA list", error: error.message });
  }
};

/* =====================================================
   EVALUATION TREND (last N months)
   GET /hrd/evaluation-trend?months=6
===================================================== */
exports.getEvaluationTrend = async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.months) || 6, 12);
    const result = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("default", { month: "short" }) +
        " '" + String(d.getFullYear()).slice(2);

      const [completed, pending] = await Promise.all([
        MonthlyEvaluation.countDocuments({ month: monthStr, status: "EVALUATED" }),
        MonthlyEvaluation.countDocuments({
          month: monthStr,
          $or: [{ status: "PENDING" }, { status: { $exists: false } }]
        })
      ]);

      result.push({ month: label, monthStr, completed, pending });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch evaluation trend", error: error.message });
  }
};

/* =====================================================
   DEPARTMENT DISTRIBUTION
   GET /hrd/department-stats
   FIX 4: null, "", and the literal string "N/A" all map to "Unassigned"
===================================================== */
exports.getDepartmentStats = async (req, res) => {
  try {
    const depts = await User.aggregate([
      {
        $match: { role: { $in: ["EMPLOYEE", "RA"] }, isActive: true }
      },
      {
        $group: {
          _id: {
            $cond: [
              // FIX 4: treat null, empty string, and the literal "N/A" all as "Unassigned"
              { $in: ["$department", [null, "", "N/A", "n/a", "NA"]] },
              "Unassigned",
              "$department"
            ]
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json(
      depts.map(d => ({
        department: d._id || "Unassigned",
        count: d.count
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch department stats", error: error.message });
  }
};

/* =====================================================
   GET EMPLOYEE DETAIL (plans, evals, quarterly)
===================================================== */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await User.findById(id)
      .select("name employeeCode department role reportingAuthorityId")
      .populate("reportingAuthorityId", "name employeeCode")
      .lean();

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const monthlyPlans = await MonthlyPlan.find({ employeeId: id })
      .sort({ month: -1 })
      .limit(12)
      .lean();

    const monthlyEvaluations = await MonthlyEvaluation.find({ employeeId: id })
      .populate("raId", "name employeeCode")
      .sort({ month: -1 })
      .limit(12)
      .lean();

    const quarterlyEvaluations = await QuarterlyEvaluation.find({ employeeId: id })
      .populate("raId", "name employeeCode")
      .sort({ createdAt: -1 })
      .lean();

    const monthlyAchievements = await MonthlyAchievement.find({ employeeId: id }).lean();

    const yearlyPlans = await YearlyPlan.find({ employeeId: id })
      .sort({ submittedAt: -1 })
      .lean();

    const yearlyReports = await YearlyAppraisalReport.find({ employeeId: id })
      .sort({ submittedAt: -1 })
      .lean();

    res.json({
      employee,
      monthlyPlans,
      monthlyEvaluations,
      quarterlyEvaluations,
      monthlyAchievements,
      yearlyPlans,
      yearlyReports
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch employee detail", error: error.message });
  }
};

/* =====================================================
   ALL MONTHLY PLANS — for HRD read-only overview
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

    const result = await Promise.all(plans.map(async (p) => {
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
        hasAchievement: !!achievement && achievement.status !== "DRAFT",
        evaluationScore: evaluation?.score || null
      };
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL EMPLOYEES LIST — for HRD directory
===================================================== */
exports.getAllEmployees = async (req, res) => {
  try {
    const filter = { role: { $in: ["EMPLOYEE", "RA"] } };

    if (req.query.q) {
      const regex = new RegExp(req.query.q, "i");
      filter.$or = [{ name: regex }, { employeeCode: regex }];
    }

    if (req.query.role) {
      filter.role = req.query.role;
    }

    const limit = parseInt(req.query.limit, 10) || 200;

    const employees = await User.find(filter, "name employeeCode department role")
      .sort({ name: 1 })
      .limit(limit);

    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   SEARCH USERS (employees + RAs) — autocomplete
===================================================== */
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) {
      return res.json([]);
    }

    const regex = new RegExp(q, "i");
    const users = await User.find({
      name: regex,
      role: { $in: ["EMPLOYEE", "RA"] },
      isActive: true
    })
      .select("name employeeCode department role")
      .limit(10)
      .lean();

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Search failed", error: error.message });
  }
};

/* =====================================================
   GENERATE YEARLY APPRAISAL
===================================================== */
exports.generateYearlyAppraisal = async (req, res) => {
  try {
    const { employeeId, financialYear } = req.body;

    const quarters = await QuarterlyEvaluation.find({ employeeId });

    if (quarters.length === 0) {
      return res.status(400).json({ message: "No quarterly evaluations found" });
    }

    const appraisal = await YearlyAppraisal.create({
      employeeId,
      financialYear,
      quarterlyEvaluations: quarters.map(q => q._id)
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "GENERATE",
      entityType: "YEARLY_APPRAISAL",
      entityId: appraisal._id,
      ipAddress: req.ip
    });

    res.status(201).json({
      message: "Yearly appraisal generated",
      appraisalId: appraisal._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   HRD REVIEW
===================================================== */
exports.hrdReview = async (req, res) => {
  try {
    const { appraisalId, hrdRemarks, hrdRating } = req.body;

    const appraisal = await YearlyAppraisal.findById(appraisalId);

    if (!appraisal) {
      return res.status(404).json({ message: "Appraisal not found" });
    }

    appraisal.hrdRemarks = hrdRemarks;
    appraisal.hrdRating = hrdRating;
    appraisal.status = "HRD_REVIEWED";

    await appraisal.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "REVIEW",
      entityType: "YEARLY_APPRAISAL",
      entityId: appraisal._id,
      ipAddress: req.ip
    });

    res.json({ message: "HRD review submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   HRD: EVALUATE YEARLY APPRAISAL REPORT
===================================================== */


exports.evaluateYearlyReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { hrdOfficeTimeDiscipline, hrdLeaveTraits, hrdTotalScore, hrdRemarks } = req.body;

    const report = await YearlyAppraisalReport.findById(id);
    if (!report) {
      return res.status(404).json({ message: "Yearly appraisal report not found" });
    }

    if (["MD_EVALUATED", "COMPLETED"].includes(report.status)) {
      return res.status(400).json({ message: "Cannot modify evaluation; MD has already finalized this report." });
    }

    let total = 0;
    if (hrdTotalScore !== undefined) {
      total = Number(hrdTotalScore) || 0;
    } else {
      total = (Number(hrdOfficeTimeDiscipline) || 0) + (Number(hrdLeaveTraits) || 0);
    }

    if (total > 5) {
      return res.status(400).json({ message: "HRD total score cannot exceed 5" });
    }

    if (hrdOfficeTimeDiscipline !== undefined) report.hrdOfficeTimeDiscipline = hrdOfficeTimeDiscipline;
    if (hrdLeaveTraits !== undefined) report.hrdLeaveTraits = hrdLeaveTraits;
    report.hrdTotalScore = total;
    if (hrdRemarks !== undefined) report.hrdRemarks = hrdRemarks;
    report.hrdEvaluatedAt = new Date();

    if (report.status === "RA_EVALUATED" || report.status === "SUBMITTED") {
      report.status = "HRD_EVALUATED";
    }
    await report.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "HRD_EVALUATE",
      entityType: "YEARLY_APPRAISAL_REPORT",
      entityId: report._id,
      ipAddress: req.ip
    });

    res.json({ message: "HRD evaluation submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   ALL YEARLY PLANS
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
   ALL YEARLY REPORTS
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

/* =====================================================
   AVAILABLE EMPLOYEES FOR RA ASSIGNMENT
===================================================== */
exports.getAvailableEmployeesForRA = async (req, res) => {
  try {
    const employees = await User.find({ role: "EMPLOYEE", isActive: true })
      .select("name employeeCode department reportingAuthorityId")
      .populate("reportingAuthorityId", "name")
      .sort({ name: 1 })
      .lean();
    res.json(employees);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch available employees", error: error.message });
  }
};

/* =====================================================
   ASSIGN EMPLOYEES TO RA
===================================================== */
exports.assignEmployeesToRA = async (req, res) => {
  try {
    const { id } = req.params; // RA ID
    const { employeeIds } = req.body;

    if (!Array.isArray(employeeIds)) {
      return res.status(400).json({ message: "employeeIds must be an array" });
    }

    const ra = await User.findById(id);
    if (!ra || ra.role !== "RA") {
      return res.status(404).json({ message: "Reporting Authority not found" });
    }

    await User.updateMany(
      { _id: { $in: employeeIds }, role: "EMPLOYEE" },
      { $set: { reportingAuthorityId: id } }
    );

    await AuditLog.create({
      userId: req.user.userId,
      action: "ASSIGN_EMPLOYEES_TO_RA",
      entityType: "USER",
      entityId: id,
      ipAddress: req.ip
    });

    res.json({ message: "Employees successfully assigned to Reporting Authority" });
  } catch (error) {
    res.status(500).json({ message: "Failed to assign employees", error: error.message });
  }
};