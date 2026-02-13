const mongoose = require("mongoose");

const yearlyPlanSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  financialYear: {
    type: String, // "2025-26"
    required: true
  },

  planDetails: {
    type: String,
    required: true
  },

  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED"],
    default: "PENDING"
  },

  mdRemarks: String,

  version: {
    type: Number,
    default: 1
  },

  submittedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("YearlyPlan", yearlyPlanSchema);
