const mongoose = require("mongoose");

const yearlyAppraisalSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  financialYear: {
    type: String, // "2025-26"
    required: true
  },

  quarterlyEvaluations: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuarterlyEvaluation"
    }
  ],

  hrdRemarks: {
    type: String
  },

  hrdRating: {
    type: Number,
    min: 0,
    max: 10
  },

  mdRemarks: {
    type: String
  },

  mdFinalRating: {
    type: Number,
    min: 0,
    max: 10
  },

  status: {
    type: String,
    enum: ["DRAFT", "HRD_REVIEWED", "APPROVED", "REJECTED"],
    default: "DRAFT"
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("YearlyAppraisal", yearlyAppraisalSchema);
