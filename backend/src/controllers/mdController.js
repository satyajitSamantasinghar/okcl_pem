const YearlyAppraisal = require("../models/YearlyAppraisal");
const AuditLog = require("../models/AuditLog");

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
