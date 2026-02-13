const YearlyAppraisal = require("../models/YearlyAppraisal");
const QuarterlyEvaluation = require("../models/QuarterlyEvaluation");
const AuditLog = require("../models/AuditLog");

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
