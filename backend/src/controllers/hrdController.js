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

    // Validate month format if provided
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: "Invalid month format. Use YYYY-MM." });
    }

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
   FIX: Eliminated N+1 queries — now uses a single batch
   fetch for all employees and all evaluations, then
   maps them in-memory. O(RAs + Employees + Evals)
   instead of O(RAs × DB round trips).
===================================================== */
exports.getRAList = async (req, res) => {
  try {
    const month = req.query.month;

    // 1. Fetch all active RAs
    const ras = await User.find({ role: "RA", isActive: true })
      .select("name employeeCode department")
      .lean();

    if (ras.length === 0) return res.json([]);

    const raIds = ras.map(r => r._id);

    // 2. Fetch ALL employees under any of these RAs in one query
    const allEmployees = await User.find({
      reportingAuthorityId: { $in: raIds },
      isActive: true
    })
      .select("name employeeCode department reportingAuthorityId")
      .lean();

    // 3. Fetch ALL evaluations for these employees in one query (if month given)
    let evalMap = {};
    if (month && allEmployees.length > 0) {
      const empIds = allEmployees.map(e => e._id);
      const evaluations = await MonthlyEvaluation.find({
        employeeId: { $in: empIds },
        month
      }).select("employeeId raId status score").lean();

      evaluations.forEach(ev => {
        evalMap[ev.employeeId.toString()] = {
          status: ev.status,
          score: ev.score
        };
      });
    }

    // 4. Group employees by RA and enrich with evaluation data — pure in-memory
    const employeesByRA = {};
    raIds.forEach(id => { employeesByRA[id.toString()] = []; });
    allEmployees.forEach(emp => {
      const raId = emp.reportingAuthorityId?.toString();
      if (raId && employeesByRA[raId]) {
        employeesByRA[raId].push(emp);
      }
    });

    const result = ras.map(ra => {
      const employees = employeesByRA[ra._id.toString()] || [];
      let evaluated = 0;

      const enrichedEmployees = employees.map(emp => {
        const ev = evalMap[emp._id.toString()];
        const isEvaluated = ev && ev.status === "EVALUATED";
        if (isEvaluated) evaluated++;
        return {
          ...emp,
          evaluationStatus: ev
            ? isEvaluated ? "evaluated" : "pending"
            : "not_started",
          lastScore: isEvaluated ? ev.score : null
        };
      });

      return {
        _id: ra._id,
        name: ra.name,
        employeeCode: ra.employeeCode,
        department: ra.department,
        employeeCount: employees.length,
        evaluated,
        employees: enrichedEmployees
      };
    });

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
   FIX: Replaced N+1 per-plan queries with a single
   aggregation pipeline joining evaluations + achievements.
===================================================== */
exports.getMonthlyPlansList = async (req, res) => {
  try {
    const { month, year, status } = req.query;
    const matchFilter = {};

    if (month) {
      // Validate month format YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format. Use YYYY-MM." });
      }
      matchFilter.month = month;
    } else if (year) {
      if (!/^\d{4}$/.test(year)) {
        return res.status(400).json({ error: "Invalid year format. Use YYYY." });
      }
      matchFilter.month = { $regex: `^${year}` };
    }

    if (status) matchFilter.status = status;

    const plans = await MonthlyPlan.aggregate([
      { $match: matchFilter },
      { $sort: { month: -1, submittedAt: -1 } },
      { $limit: 100 },

      // Join employee info
      {
        $lookup: {
          from: "users",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
          pipeline: [{ $project: { name: 1, employeeCode: 1, department: 1 } }]
        }
      },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: false } },

      // Join monthly evaluation (left join — plan may have no evaluation yet)
      {
        $lookup: {
          from: "monthlyevaluations",
          let: { empId: "$employeeId", m: "$month" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$empId"] },
                    { $eq: ["$month", "$$m"] }
                  ]
                }
              }
            },
            { $project: { status: 1, score: 1, remarks: 1, evaluatedAt: 1 } }
          ],
          as: "evaluation"
        }
      },
      { $unwind: { path: "$evaluation", preserveNullAndEmptyArrays: true } },

      // Join monthly achievement
      {
        $lookup: {
          from: "monthlyachievements",
          let: { planId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$monthlyPlanId", "$$planId"] } } },
            { $project: { status: 1, achievementDetails: 1, planAchievements: 1, additionalAchievement: 1, submittedAt: 1 } }
          ],
          as: "achievement"
        }
      },
      { $unwind: { path: "$achievement", preserveNullAndEmptyArrays: true } },

      // Project final shape — mirrors the original per-plan structure
      {
        $project: {
          _id: 1,
          month: 1,
          status: 1,
          submittedAt: 1,
          planItems: 1,
          planDetails: 1,
          mdRemarks: 1,
          raRemarks: 1,
          employeeId: {
            _id: "$employee._id",
            name: "$employee.name",
            employeeCode: "$employee.employeeCode",
            department: "$employee.department"
          },
          evaluationStatus: { $ifNull: ["$evaluation.status", null] },
          evaluationScore: { $ifNull: ["$evaluation.score", null] },
          evaluationRemarks: { $ifNull: ["$evaluation.remarks", null] },
          evaluatedAt: { $ifNull: ["$evaluation.evaluatedAt", null] },
          hasAchievement: {
            $and: [
              { $ne: [{ $type: "$achievement" }, "missing"] },
              { $ne: ["$achievement.status", "DRAFT"] }
            ]
          },
          achievementStatus: { $ifNull: ["$achievement.status", null] },
          achievementDetails: { $ifNull: ["$achievement.achievementDetails", null] },
          planAchievements: { $ifNull: ["$achievement.planAchievements", []] },
          additionalAchievement: { $ifNull: ["$achievement.additionalAchievement", null] },
          achievementDate: { $ifNull: ["$achievement.submittedAt", null] }
        }
      }
    ]);

    res.json(plans);
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
   FIX: Now searches by both name AND employeeCode.
   Added input length guard to prevent regex DoS.
===================================================== */
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json([]);
    }
    // Guard against excessively long search strings (regex DoS)
    const sanitized = q.trim().substring(0, 60);
    const regex = new RegExp(sanitized, "i");

    const users = await User.find({
      $or: [{ name: regex }, { employeeCode: regex }],
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
      .populate("yearlyPlanId", "planAndObjectives financialYear version status submittedAt editHistory mdRemarks")
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