const mongoose = require("mongoose");

const yearlyAchievementSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    yearlyPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "YearlyPlan",
      required: true
    },

    tasksCompleted: {
      type: String,
      required: true
    },

    additionalTasks: {
      type: String
    },

    submittedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "YearlyAchievement",
  yearlyAchievementSchema
);
