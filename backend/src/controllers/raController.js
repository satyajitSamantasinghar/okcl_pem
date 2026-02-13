const MonthlyEvaluation = require("../models/MonthlyEvaluation");
const QuarterlyEvaluation = require("../models/QuarterlyEvaluation");
const MonthlyAchievement = require("../models/MonthlyAchievement");
const MonthlyPlan = require("../models/MonthlyPlan");
const AuditLog = require("../models/AuditLog");

/* =====================================================
   1. RA DASHBOARD (EMPLOYEE-DRIVEN, SRS CORRECT)
===================================================== */
exports.getRADashboard = async (req, res) => {
  try {
    const raId = req.user.userId;
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({
        message: "Month is required"
      });
    }

    const User = require("../models/User");

    // 1️⃣ Total employees under RA
    const employees = await User.find({ reportingAuthorityId: raId }).select("_id");
    const employeeIds = employees.map(emp => emp._id);

    const totalEmployees = employeeIds.length;

    // 2️⃣ Approved Monthly Plans
    const totalPlansSubmitted = await MonthlyPlan.countDocuments({
      employeeId: { $in: employeeIds },
      month,
      status: "APPROVED"
    });

    // 3️⃣ Achievements submitted
    const plans = await MonthlyPlan.find({
      employeeId: { $in: employeeIds },
      month,
      status: "APPROVED"
    }).select("_id");

    const planIds = plans.map(p => p._id);

    const totalAchievementsSubmitted = await MonthlyAchievement.countDocuments({
      monthlyPlanId: { $in: planIds }
    });

    // 4️⃣ Evaluated employees
    const totalEvaluated = await MonthlyEvaluation.countDocuments({
      employeeId: { $in: employeeIds },
      month,
      raId,
      status: "EVALUATED"
    });

    res.json({
      totalEmployees,
      totalPlansSubmitted,
      totalAchievementsSubmitted,
      totalEvaluated
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to load RA dashboard",
      error: error.message
    });
  }
};

/* =====================================================
   2. SUBMIT MONTHLY EVALUATION
===================================================== */
exports.submitMonthlyEvaluation = async (req, res) => {
  try {
    const { evaluationId, score, remarks } = req.body;

    if (req.user.role !== "RA") {
      return res.status(403).json({
        message: "Only Reporting Authority can evaluate"
      });
    }

    const evaluation = await MonthlyEvaluation.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({ message: "Evaluation not found" });
    }

    if (evaluation.status === "EVALUATED") {
      return res.status(400).json({
        message: "Evaluation already submitted"
      });
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
    res.status(500).json({
      message: "Failed to submit evaluation",
      error: error.message
    });
  }
};

/* =====================================================
   3. GET MONTHLY EVALUATIONS
   Employee: remarks only
   RA: remarks + score
===================================================== */
exports.getMonthlyEvaluations = async (req, res) => {
  try {
    let filter = {};
    let projection = {};

    /* ---------- Pagination ---------- */
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    /* ---------- Role-based filtering ---------- */
    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;

      // Employee sees remarks only
      projection = {
        score: 0,
        raId: 0
      };
    }

    else if (req.user.role === "RA") {
      filter.raId = req.user.userId;
    }

    else if (req.user.role === "HRD" || req.user.role === "MD") {
      // Prevent accidental data flooding
      if (!req.query.month && !req.query.year) {
        return res.status(400).json({
          message: "Month or year is required for HRD/MD view"
        });
      }

      if (req.query.employeeId) {
        filter.employeeId = req.query.employeeId;
      }
    }

    /* ---------- Common filters ---------- */
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = req.query.year;

    /* ---------- DB query ---------- */
    const evaluations = await MonthlyEvaluation.find(filter, projection)
      .populate("employeeId", "name employeeCode department")
      .populate("monthlyPlanId", "month planDetails")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await MonthlyEvaluation.countDocuments(filter);

    /* ---------- Response ---------- */
    const response = evaluations.map(ev => ({
      _id: ev._id,
      employee: ev.employeeId,
      month: ev.month,
      remarks: ev.remarks || null,
      score: req.user.role === "EMPLOYEE" ? null : ev.score,
      status: ev.status
    }));

    res.json({
      page,
      limit,
      totalRecords: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      data: response
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch monthly evaluations",
      error: error.message
    });
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
      return res.status(404).json({
        message: "Monthly evaluation not found"
      });
    }

    /* ===============================
       SECURITY: OWNERSHIP & ROLE CHECKS
    =============================== */

    // RA can access only their own evaluations
    if (
      req.user.role === "RA" &&
      evaluation.raId._id.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "You are not authorized to view this evaluation"
      });
    }

    // Employee can access only their own evaluations
    if (
      req.user.role === "EMPLOYEE" &&
      evaluation.employeeId._id.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "You are not authorized to view this evaluation"
      });
    }

    /* ===============================
       FETCH ACHIEVEMENT
    =============================== */
    const achievement = await MonthlyAchievement.findOne({
      monthlyPlanId: evaluation.monthlyPlanId._id
    });

    /* ===============================
       ROLE-BASED VISIBILITY
    =============================== */
    const canViewScore =
      req.user.role === "RA" ||
      req.user.role === "HRD" ||
      req.user.role === "MD";

    /* ===============================
       RESPONSE
    =============================== */
    res.json({
      plan: evaluation.monthlyPlanId,
      achievement: achievement || null,

      // visible to all allowed roles
      remarks: evaluation.remarks || null,

      // visible to RA, HRD, MD only
      score: canViewScore ? evaluation.score : null,

      status: {
        planSubmitted: true,
        achievementSubmitted: !!achievement,
        evaluated: evaluation.status === "EVALUATED"
      }
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch monthly evaluation",
      error: error.message
    });
  }
};


/* =====================================================
   5. GENERATE QUARTERLY EVALUATION
===================================================== */
exports.generateQuarterlyEvaluation = async (req, res) => {
  try {
    const { employeeId, quarter, months, remarks } = req.body;

    if (req.user.role !== "RA") {
      return res.status(403).json({
        message: "Only Reporting Authority can generate quarterly evaluation"
      });
    }

    if (!employeeId || !quarter || !Array.isArray(months)) {
      return res.status(400).json({
        message: "employeeId, quarter and months are required"
      });
    }

    if (months.length !== 3) {
      return res.status(400).json({
        message: "Quarterly evaluation requires exactly 3 months"
      });
    }

    // Prevent duplicate quarterly evaluation
    const existing = await QuarterlyEvaluation.findOne({
      employeeId,
      quarter
    });

    if (existing) {
      return res.status(400).json({
        message: "Quarterly evaluation already exists for this quarter"
      });
    }

    // Fetch evaluated monthly records (same RA)
    const evaluations = await MonthlyEvaluation.find({
      employeeId,
      raId: req.user.userId,
      month: { $in: months },
      status: "EVALUATED"
    });

    if (evaluations.length !== 3) {
      return res.status(400).json({
        message: "All three months must be evaluated before generating quarterly evaluation"
      });
    }

    const totalScore = evaluations.reduce(
      (sum, ev) => sum + ev.score,
      0
    );

    const averageScore = totalScore / 3;

    const quarterly = await QuarterlyEvaluation.create({
      employeeId,
      quarter,
      raId: req.user.userId,
      averageScore,
      remarks: remarks || null
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "GENERATE",
      entityType: "QUARTERLY_EVALUATION",
      entityId: quarterly._id,
      ipAddress: req.ip
    });

    res.json({
      message: "Quarterly evaluation generated successfully",
      averageScore
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to generate quarterly evaluation",
      error: error.message
    });
  }
};

/* =====================================================
   GET QUARTERLY EVALUATIONS (SAFE VERSION)
===================================================== */
exports.getQuarterlyEvaluations = async (req, res) => {
  try {
    let filter = {};
    let projection = {};

    /* ===============================
       PAGINATION (COMMON FOR ALL)
    =============================== */
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    /* ===============================
       EMPLOYEE VIEW
       - Own data only
       - Remarks only
    =============================== */
    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;

      projection = {
        averageScore: 0,
        raId: 0
      };
    }

    /* ===============================
       RA VIEW
       - Employees under RA
       - Full visibility
    =============================== */
    else if (req.user.role === "RA") {
      filter.raId = req.user.userId;
    }

    /* ===============================
       HRD / MD VIEW
       - MUST filter by quarter or year
       - Read-only
    =============================== */
    else if (req.user.role === "HRD" || req.user.role === "MD") {

      // ⛔ Prevent data flooding
      if (!req.query.quarter && !req.query.year) {
        return res.status(400).json({
          message: "Quarter or year is required for HRD/MD view"
        });
      }

      if (req.query.employeeId) {
        filter.employeeId = req.query.employeeId;
      }
    }

    /* ===============================
       COMMON FILTERS
    =============================== */
    if (req.query.quarter) {
      filter.quarter = req.query.quarter;
    }

    if (req.query.year) {
      filter.year = req.query.year;
    }

    /* ===============================
       DATABASE QUERY
    =============================== */
    const evaluations = await QuarterlyEvaluation.find(filter, projection)
      .populate("employeeId", "name employeeCode department")
      .populate(
        req.user.role === "EMPLOYEE" ? "" : "raId",
        "name employeeCode"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    /* ===============================
       TOTAL COUNT (for frontend)
    =============================== */
    const totalCount = await QuarterlyEvaluation.countDocuments(filter);

    /* ===============================
       RESPONSE MAPPING
    =============================== */
    const response = evaluations.map(ev => ({
      _id: ev._id,
      employee: ev.employeeId,
      quarter: ev.quarter,
      remarks: ev.remarks || null,

      averageScore:
        req.user.role === "EMPLOYEE"
          ? null
          : ev.averageScore
    }));

    res.json({
      page,
      limit,
      totalRecords: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      data: response
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch quarterly evaluations",
      error: error.message
    });
  }
};
exports.getQuarterlyEvaluationById = async (req, res) => {
  try {
    const quarterly = await QuarterlyEvaluation.findById(req.params.id)
      .populate("employeeId", "name employeeCode department")
      .populate("raId", "name employeeCode");

    if (!quarterly) {
      return res.status(404).json({
        message: "Quarterly evaluation not found"
      });
    }

    /* ===============================
       SECURITY: OWNERSHIP CHECKS
    =============================== */

    // RA can access only their own quarterly evaluations
    if (
      req.user.role === "RA" &&
      quarterly.raId._id.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "You are not authorized to view this quarterly evaluation"
      });
    }

    // Employee can access only their own quarterly evaluations
    if (
      req.user.role === "EMPLOYEE" &&
      quarterly.employeeId._id.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "You are not authorized to view this quarterly evaluation"
      });
    }

    /* ===============================
       ROLE-BASED VISIBILITY
    =============================== */

    const canViewScore =
      req.user.role === "RA" ||
      req.user.role === "HRD" ||
      req.user.role === "MD";

    /* ===============================
       RESPONSE
    =============================== */

    res.json({
      _id: quarterly._id,
      employee: quarterly.employeeId,
      quarter: quarterly.quarter,
      remarks: quarterly.remarks || null,
      averageScore: canViewScore ? quarterly.averageScore : null,
      generatedAt: quarterly.createdAt
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch quarterly evaluation",
      error: error.message
    });
  }
};


