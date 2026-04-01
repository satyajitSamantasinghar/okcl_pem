const mongoose = require("mongoose");

const monthlyPlanSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  month: {
    type: String, // e.g. "2026-01"
    required: true,
  },

  // New: each element is one plan box the employee filled in
  // e.g. ["Do KRA training", "Complete DAV project", "Submit quarterly report"]
  planItems: {
    type: [String],
    default: [],
  },

  // Legacy / display field — auto-joined from planItems on save.
  // Kept so that older RA / admin views that only read planDetails continue working.
  planDetails: {
    type: String,
    required: true,
  },

  status: {
    type: String,
    enum: ["DRAFT", "PENDING", "APPROVED", "REJECTED"],
    default: "PENDING",
  },

  mdRemarks: String,

  version: {
    type: Number,
    default: 1,
  },

  submittedAt: {
    type: Date,
    default: Date.now,
  },
});

/* ── Pre-save hook: keep planDetails in sync with planItems ──
   If planItems is populated, derive planDetails from it so all
   existing code that reads planDetails still works correctly.   */
monthlyPlanSchema.pre("save", async function () {
  if (this.planItems && this.planItems.length > 0) {
    this.planDetails = this.planItems.filter(Boolean).join("\n");
  }
});

module.exports = mongoose.model("MonthlyPlan", monthlyPlanSchema);