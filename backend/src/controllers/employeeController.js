const MonthlyPlan = require("../models/MonthlyPlan");
const AuditLog = require("../models/AuditLog");
const YearlyPlan = require("../models/YearlyPlan");
const MonthlyAchievement = require("../models/MonthlyAchievement");
const YearlyAchievement=require("../models/YearlyAchievement");

// ✅ Added these two imports to link the Evaluation to the RA
const MonthlyEvaluation = require("../models/MonthlyEvaluation");
const User = require("../models/User");

// 1. Submit Monthly Plan (UPDATED FIX)
exports.submitMonthlyPlan = async (req, res) => {
  try {
    const { month, planDetails } = req.body;

    const existingPlan = await MonthlyPlan.findOne({
      employeeId: req.user.userId,
      month
    });

    if (existingPlan) {
      return res.status(409).json({
        message: "Monthly plan already submitted for this month"
      });
    }

    // 1. Create the Plan
    const plan = await MonthlyPlan.create({
      employeeId: req.user.userId,
      month,
      planDetails
    });

    // 2. ✅ AUTOMATIC FIX: Create the Evaluation Record for the RA
    // Fetch the user to get their Reporting Authority ID
    const user = await User.findById(req.user.userId);

    if (user && user.reportingAuthorityId) {
      // Check if evaluation already exists (just in case)
      const existingEval = await MonthlyEvaluation.findOne({
        employeeId: req.user.userId,
        month: month
      });

      if (!existingEval) {
        await MonthlyEvaluation.create({
          employeeId: req.user.userId,
          monthlyPlanId: plan._id,
          raId: user.reportingAuthorityId, // Links to RA Dashboard
          month: month,
          score: 0, // Default 0 (treated as "Pending" by your logic)
          remarks: "" 
        });
      }
    }

    // 3. Audit Log
    await AuditLog.create({
      userId: req.user.userId,
      action: "SUBMIT",
      entityType: "MONTHLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.status(201).json({
      message: "Monthly plan submitted",
      monthlyPlanId: plan._id
    });

  } catch (error) {
    console.error("Submit Plan Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// 2. Submit Monthly Achievement
exports.submitMonthlyAchievement = async (req, res) => {
  try {
    const { monthlyPlanId, achievementDetails } = req.body;

    const plan = await MonthlyPlan.findOne({
      _id: monthlyPlanId,
      employeeId: req.user.userId
    });

    if (!plan) {
      return res.status(404).json({
        message: "Monthly plan not found for this employee"
      });
    }

    const existingAchievement = await MonthlyAchievement.findOne({
      employeeId: req.user.userId,
      monthlyPlanId: plan._id
    });


    if (existingAchievement) {
      return res.status(409).json({
        message: "Monthly achievement already submitted for this month"
      });
    }

    const achievement = await MonthlyAchievement.create({
      employeeId: req.user.userId,
      monthlyPlanId,
      achievementDetails
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "SUBMIT",
      entityType: "MONTHLY_ACHIEVEMENT",
      entityId: achievement._id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: "Monthly achievement submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// 3. Submit Yearly Plan
exports.submitYearlyPlan = async (req, res) => {
  try {
    const { financialYear, planDetails } = req.body;

    const existingPlan = await YearlyPlan.findOne({
      employeeId: req.user.userId,
      financialYear
    });

    if (existingPlan) {
      return res.status(409).json({
        message: "Yearly plan already submitted for this financial year"
      });
    }

    const plan = await YearlyPlan.create({
      employeeId: req.user.userId,
      financialYear,
      planDetails
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "SUBMIT",
      entityType: "YEARLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: "Yearly plan submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 4. Get Monthly Plans
exports.getMonthlyPlans = async (req, res) => {
  try {
    let filter = {};

    // EMPLOYEE → only own data
    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
    }

    // Optional query filters (month, employeeId)
    if (req.query.month) {
      filter.month = req.query.month;
    }

    if (req.query.employeeId && req.user.role !== "EMPLOYEE") {
      filter.employeeId = req.query.employeeId;
    }

    const plans = await MonthlyPlan.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ submittedAt: -1 });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch monthly plans" });
  }
};

// 5. Get Monthly Achievements
exports.getMonthlyAchievements = async (req, res) => {
  try {
    let filter = {};

    // EMPLOYEE → only own achievements
    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
    }

    // Optional query filters
    if (req.query.monthlyPlanId) {
      filter.monthlyPlanId = req.query.monthlyPlanId;
    }

    if (req.query.employeeId && req.user.role !== "EMPLOYEE") {
      filter.employeeId = req.query.employeeId;
    }

    const achievements = await MonthlyAchievement.find(filter)
      .populate("employeeId", "name employeeCode department")
      .populate("monthlyPlanId", "month planDetails")
      .sort({ submittedAt: -1 });

    res.json(achievements);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch monthly achievements"
    });
  }
};


exports.getYearlyPlans = async (req, res) => {
  try {
    const plans = await YearlyPlan.find({
      employeeId: req.user.userId
    }).sort({ createdAt: -1 });

    res.json(plans);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch yearly plans"
    });
  }
};



exports.submitYearlyAchievement = async (req, res) => {
  try {
    const { yearlyPlanId, tasksCompleted, additionalTasks } = req.body;

    // 1️⃣ Check yearly plan exists & belongs to employee
    const plan = await YearlyPlan.findOne({
      _id: yearlyPlanId,
      employeeId: req.user.userId
    });

    if (!plan) {
      return res.status(404).json({
        message: "Yearly plan not found"
      });
    }

    // 2️⃣ Prevent duplicate yearly achievement
    const existingAchievement = await YearlyAchievement.findOne({
      employeeId: req.user.userId,
      yearlyPlanId
    });

    if (existingAchievement) {
      return res.status(409).json({
        message: "Yearly achievement already submitted"
      });
    }

    // 3️⃣ Create achievement
    const achievement = await YearlyAchievement.create({
      employeeId: req.user.userId,
      yearlyPlanId,
      tasksCompleted,
      additionalTasks
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "SUBMIT",
      entityType: "YEARLY_ACHIEVEMENT",
      entityId: achievement._id,
      ipAddress: req.ip
    });

    res.status(201).json({
      message: "Yearly achievement submitted successfully"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};




