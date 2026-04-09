const MonthlyPlan = require("../models/MonthlyPlan");
const AuditLog = require("../models/AuditLog");
const YearlyPlan = require("../models/YearlyPlan");
const MonthlyAchievement = require("../models/MonthlyAchievement");
const YearlyAchievement = require("../models/YearlyAchievement");

// ✅ Added these two imports to link the Evaluation to the RA
const MonthlyEvaluation = require("../models/MonthlyEvaluation");
const User = require("../models/User");

// 1. Submit Monthly Plan (UPDATED — supports resubmission after rejection & drafts)
exports.submitMonthlyPlan = async (req, res) => {
  try {
    const { month, planDetails, status } = req.body;
    const planStatus = status === "DRAFT" ? "DRAFT" : "PENDING";

    const existingPlan = await MonthlyPlan.findOne({
      employeeId: req.user.userId,
      month
    });

    if (existingPlan) {
      // Allow resubmission if plan was REJECTED
      if (existingPlan.status === "REJECTED") {
        existingPlan.planDetails = planDetails;
        existingPlan.status = planStatus;
        existingPlan.mdRemarks = undefined;
        existingPlan.version = (existingPlan.version || 1) + 1;
        existingPlan.submittedAt = new Date();
        await existingPlan.save();

        // Reset linked MonthlyEvaluation (so RA can re-evaluate)
        await MonthlyEvaluation.findOneAndUpdate(
          { employeeId: req.user.userId, month },
          { score: 0, remarks: "", status: "PENDING", monthlyPlanId: existingPlan._id }
        );

        // Delete old achievement so employee can submit fresh one
        await MonthlyAchievement.deleteMany({
          employeeId: req.user.userId,
          monthlyPlanId: existingPlan._id
        });

        await AuditLog.create({
          userId: req.user.userId,
          action: "RESUBMIT",
          entityType: "MONTHLY_PLAN",
          entityId: existingPlan._id,
          ipAddress: req.ip
        });

        return res.json({
          message: "Plan resubmitted successfully",
          monthlyPlanId: existingPlan._id
        });
      }

      // Allow updating a DRAFT to submitted or updated draft
      if (existingPlan.status === "DRAFT") {
        existingPlan.planDetails = planDetails;
        existingPlan.status = planStatus;
        existingPlan.submittedAt = new Date();
        await existingPlan.save();

        // If submitting (not draft), create evaluation record for RA
        if (planStatus === "PENDING") {
          const user = await User.findById(req.user.userId);
          if (user && user.reportingAuthorityId) {
            const existingEval = await MonthlyEvaluation.findOne({
              employeeId: req.user.userId, month
            });
            if (!existingEval) {
              await MonthlyEvaluation.create({
                employeeId: req.user.userId,
                monthlyPlanId: existingPlan._id,
                raId: user.reportingAuthorityId,
                month, score: 0, remarks: ""
              });
            }
          }
        }

        await AuditLog.create({
          userId: req.user.userId,
          action: planStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT",
          entityType: "MONTHLY_PLAN",
          entityId: existingPlan._id,
          ipAddress: req.ip
        });

        return res.json({
          message: planStatus === "DRAFT" ? "Draft updated" : "Plan submitted",
          monthlyPlanId: existingPlan._id
        });
      }

      // Otherwise block duplicate submission
      return res.status(409).json({
        message: "Monthly plan already submitted for this month"
      });
    }

    // 1. Create the Plan
    const plan = await MonthlyPlan.create({
      employeeId: req.user.userId,
      month,
      planDetails,
      status: planStatus
    });

    // 2. Create Evaluation Record for RA (only for non-draft plans)
    if (planStatus === "PENDING") {
      const user = await User.findById(req.user.userId);
      if (user && user.reportingAuthorityId) {
        const existingEval = await MonthlyEvaluation.findOne({
          employeeId: req.user.userId, month
        });
        if (!existingEval) {
          await MonthlyEvaluation.create({
            employeeId: req.user.userId,
            monthlyPlanId: plan._id,
            raId: user.reportingAuthorityId,
            month, score: 0, remarks: ""
          });
        }
      }
    }

    // 3. Audit Log
    await AuditLog.create({
      userId: req.user.userId,
      action: planStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT",
      entityType: "MONTHLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.status(201).json({
      message: planStatus === "DRAFT" ? "Draft saved" : "Monthly plan submitted",
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
    const { monthlyPlanId, achievementDetails, planAchievements, additionalAchievement, status } = req.body;
    const achStatus = status === "DRAFT" ? "DRAFT" : "SUBMITTED";

    const plan = await MonthlyPlan.findOne({
      _id: monthlyPlanId,
      employeeId: req.user.userId
    });

    if (!plan) {
      return res.status(404).json({
        message: "Monthly plan not found for this employee"
      });
    }

    // Enforce workflow: achievement can only be submitted after the plan is formally submitted
    if (plan.status === "DRAFT") {
      return res.status(400).json({
        message: "You must submit your monthly plan before adding an achievement. Please finalise and submit the plan first."
      });
    }

    // Also block achievement against a rejected plan (employee must resubmit plan first)
    if (plan.status === "REJECTED") {
      return res.status(400).json({
        message: "Your monthly plan was rejected. Please resubmit the plan before adding an achievement."
      });
    }

    // Check if draft exists — allow updating it
    const existingAchievement = await MonthlyAchievement.findOne({
      employeeId: req.user.userId,
      monthlyPlanId: plan._id
    });

    if (existingAchievement) {
      if (existingAchievement.status === "SUBMITTED") {
        return res.status(409).json({
          message: "Monthly achievement already submitted for this month"
        });
      }
      // Update the draft
      existingAchievement.achievementDetails = achievementDetails;
      if (planAchievements !== undefined) existingAchievement.planAchievements = planAchievements;
      if (additionalAchievement !== undefined) existingAchievement.additionalAchievement = additionalAchievement;
      existingAchievement.status = achStatus;
      if (achStatus === "SUBMITTED") existingAchievement.submittedAt = new Date();
      await existingAchievement.save();

      await AuditLog.create({
        userId: req.user.userId,
        action: achStatus === "DRAFT" ? "DRAFT_UPDATE" : "SUBMIT",
        entityType: "MONTHLY_ACHIEVEMENT",
        entityId: existingAchievement._id,
        ipAddress: req.ip
      });

      return res.json({ message: achStatus === "DRAFT" ? "Draft saved" : "Achievement submitted" });
    }

    const achievement = await MonthlyAchievement.create({
      employeeId: req.user.userId,
      monthlyPlanId,
      achievementDetails,
      planAchievements,
      additionalAchievement,
      status: achStatus
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: achStatus === "DRAFT" ? "DRAFT_SAVE" : "SUBMIT",
      entityType: "MONTHLY_ACHIEVEMENT",
      entityId: achievement._id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: achStatus === "DRAFT" ? "Draft saved" : "Monthly achievement submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// 3. Submit Yearly Plan (Enhanced)
exports.submitYearlyPlan = async (req, res) => {
  try {
    const { financialYear, planAndObjectives } = req.body;

    if (!financialYear || !planAndObjectives) {
      return res.status(400).json({ message: "All fields are required (financialYear, planAndObjectives)" });
    }

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
      planAndObjectives
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "SUBMIT",
      entityType: "YEARLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: "Yearly plan submitted successfully", planId: plan._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3b. Edit Yearly Plan
exports.editYearlyPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { planAndObjectives } = req.body;

    const plan = await YearlyPlan.findOne({
      _id: id,
      employeeId: req.user.userId
    });

    if (!plan) {
      return res.status(404).json({ message: "Yearly plan not found" });
    }

    // Cannot edit a rejected plan - must submit new one
    if (plan.status === "REJECTED") {
      return res.status(400).json({ message: "Cannot edit a rejected plan. Please submit a new plan." });
    }

    const previousStatus = plan.status;

    // Track edit history
    plan.editHistory.push({
      editedAt: new Date(),
      previousStatus,
      note: previousStatus === "APPROVED" ? "Edited after MD approval" : "Edited before approval"
    });

    // Update field
    if (planAndObjectives) plan.planAndObjectives = planAndObjectives;

    // Set status based on whether it was already approved
    if (previousStatus === "APPROVED" || previousStatus === "EDITED_AFTER_APPROVAL") {
      plan.status = "EDITED_AFTER_APPROVAL";
    } else {
      plan.status = "EDITED";
    }

    plan.version += 1;
    await plan.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "EDIT",
      entityType: "YEARLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.json({ message: "Yearly plan updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3c. Resubmit Yearly Plan (after MD rejection)
exports.resubmitYearlyPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { planAndObjectives } = req.body;

    if (!planAndObjectives || !planAndObjectives.trim()) {
      return res.status(400).json({ message: "Plan content is required for resubmission" });
    }

    const plan = await YearlyPlan.findOne({
      _id: id,
      employeeId: req.user.userId
    });

    if (!plan) {
      return res.status(404).json({ message: "Yearly plan not found" });
    }

    if (plan.status !== "REJECTED") {
      return res.status(400).json({
        message: "Only rejected plans can be resubmitted"
      });
    }

    // Record the resubmission in edit history
    plan.editHistory.push({
      editedAt: new Date(),
      previousStatus: "REJECTED",
      note: "Resubmitted after MD rejection"
    });

    plan.planAndObjectives = planAndObjectives.trim();
    plan.status = "PENDING";
    plan.mdRemarks = undefined;          // clear previous rejection remarks
    plan.version = (plan.version || 1) + 1;
    plan.submittedAt = new Date();

    await plan.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "RESUBMIT",
      entityType: "YEARLY_PLAN",
      entityId: plan._id,
      ipAddress: req.ip
    });

    res.json({ message: "Yearly plan resubmitted successfully", planId: plan._id });
  } catch (error) {
    console.error("Resubmit Yearly Plan Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// 4. Get Monthly Plans
exports.getMonthlyPlans = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
    }
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
    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
    }
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
    res.status(500).json({ message: "Failed to fetch monthly achievements" });
  }
};

// Get Yearly Plans (for all roles)
exports.getYearlyPlans = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
    }

    if (req.query.financialYear) {
      filter.financialYear = req.query.financialYear;
    }
    if (req.query.employeeId && req.user.role !== "EMPLOYEE") {
      filter.employeeId = req.query.employeeId;
    }

    const plans = await YearlyPlan.find(filter)
      .populate("employeeId", "name employeeCode department")
      .sort({ submittedAt: -1 });

    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch yearly plans" });
  }
};

// Submit Yearly Appraisal Report (replaces submitYearlyAchievement)
const YearlyAppraisalReport = require("../models/YearlyAppraisalReport");

exports.submitYearlyAppraisalReport = async (req, res) => {
  try {
    const { yearlyPlanId, financialYear, workKRA, additionalAssignments } = req.body;

    if (!financialYear || !workKRA) {
      return res.status(400).json({ message: "financialYear and workKRA are required" });
    }

    // Check for duplicates
    const existing = await YearlyAppraisalReport.findOne({
      employeeId: req.user.userId,
      financialYear
    });

    if (existing) {
      return res.status(409).json({ message: "Yearly appraisal report already submitted for this year" });
    }

    const report = await YearlyAppraisalReport.create({
      employeeId: req.user.userId,
      yearlyPlanId: yearlyPlanId || null,
      financialYear,
      workKRA,
      additionalAssignments: additionalAssignments || null
    });

    await AuditLog.create({
      userId: req.user.userId,
      action: "SUBMIT",
      entityType: "YEARLY_APPRAISAL_REPORT",
      entityId: report._id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: "Yearly appraisal report submitted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Yearly Appraisal Reports
exports.getYearlyAppraisalReports = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === "EMPLOYEE") {
      filter.employeeId = req.user.userId;
    }
    if (req.query.financialYear) {
      filter.financialYear = req.query.financialYear;
    }
    if (req.query.employeeId && req.user.role !== "EMPLOYEE") {
      filter.employeeId = req.query.employeeId;
    }

    const reports = await YearlyAppraisalReport.find(filter)
      .populate("employeeId", "name employeeCode department")
      .populate("yearlyPlanId", "financialYear planAndObjectives")
      .sort({ submittedAt: -1 });

    // Employee only sees remarks, not scores
    if (req.user.role === "EMPLOYEE") {
      const filtered = reports.map(r => ({
        _id: r._id,
        financialYear: r.financialYear,
        workKRA: r.workKRA,
        additionalAssignments: r.additionalAssignments,
        status: r.status,
        submittedAt: r.submittedAt,
        raRemarks: r.raRemarks || null,
        hrdRemarks: r.hrdRemarks || null,
        mdRemarks: r.mdRemarks || null,
        yearlyPlanId: r.yearlyPlanId
      }));
      return res.json(filtered);
    }

    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch yearly appraisal reports" });
  }
};
