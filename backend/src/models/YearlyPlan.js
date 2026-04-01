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

  planAndObjectives: {
    type: String,
    required: true
  },

  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED", "EDITED", "EDITED_AFTER_APPROVAL"],
    default: "PENDING"
  },

  mdRemarks: String,

  editHistory: [
    {
      editedAt: { type: Date, default: Date.now },
      previousStatus: String,
      note: String
    }
  ],

  version: {
    type: Number,
    default: 1
  },

  submittedAt: {
    type: Date,
    default: Date.now
  }
});

yearlyPlanSchema.index({ employeeId: 1, financialYear: 1 }, { unique: true });

module.exports = mongoose.model("YearlyPlan", yearlyPlanSchema);
