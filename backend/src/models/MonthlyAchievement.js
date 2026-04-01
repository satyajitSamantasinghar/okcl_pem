const mongoose = require("mongoose");

/* ── Sub-schema for per-plan achievement entries ── */
const planAchievementSchema = new mongoose.Schema(
  {
    // Index into the parent MonthlyPlan's planItems array (0-based)
    planIndex: {
      type: Number,
      required: true,
    },

    // What the employee wrote for this specific plan
    achievementDetails: {
      type: String,
      default: "",
    },

    // 0–100 progress indicator set by the employee
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
  },
  { _id: false } // no separate _id for sub-docs
);

/* ── Main schema ── */
const monthlyAchievementSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  monthlyPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MonthlyPlan",
    required: true,
  },

  // New: one entry per plan item — mirrors MonthlyPlan.planItems by index
  planAchievements: {
    type: [planAchievementSchema],
    default: [],
  },

  // New: free-text field for achievements outside the planned work
  additionalAchievement: {
    type: String,
    default: "",
  },

  // Legacy / summary field — still populated for backward-compat with RA views
  // that only read achievementDetails.
  achievementDetails: {
    type: String,
    default: "",
  },

  status: {
    type: String,
    enum: ["DRAFT", "SUBMITTED"],
    default: "SUBMITTED",
  },

  submittedAt: {
    type: Date,
    default: Date.now,
  },
});

/* ── Pre-save hook: keep legacy achievementDetails in sync ──
   Builds a readable summary from planAchievements so that older
   RA / admin code that reads achievementDetails still works.     */
monthlyAchievementSchema.pre("save", async function () {
  if (this.planAchievements && this.planAchievements.length > 0) {
    const lines = this.planAchievements.map(
      (a, i) =>
        `Plan ${i + 1} [${a.progress}%]: ${a.achievementDetails || "—"}`
    );
    if (this.additionalAchievement?.trim()) {
      lines.push(`Additional: ${this.additionalAchievement}`);
    }
    // Only overwrite if the caller didn't supply their own summary
    if (!this.achievementDetails || this.achievementDetails.trim() === "") {
      this.achievementDetails = lines.join("\n");
    }
  }
});

module.exports = mongoose.model("MonthlyAchievement", monthlyAchievementSchema);