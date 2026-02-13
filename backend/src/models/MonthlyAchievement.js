const mongoose = require("mongoose");

const monthlyAchievementSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  monthlyPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MonthlyPlan",
    required: true
  },

  achievementDetails: {
    type: String,
    required: true
  },

  submittedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("MonthlyAchievement", monthlyAchievementSchema);
