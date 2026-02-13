const mongoose = require("mongoose");

const monthlyPlanSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  month: {
    type: String, // e.g. "2026-01"
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

module.exports = mongoose.model("MonthlyPlan", monthlyPlanSchema);
