const mongoose = require("mongoose");

const monthlyEvaluationSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    monthlyPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MonthlyPlan",
      required: true,
      unique: true // ✅ one evaluation per plan
    },

    raId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    month: {
      type: String, // "2026-01"
      required: true
    },

    score: {
      type: Number,
      min: 0,
      max: 10,
      default: null
    },

    remarks: {
      type: String,
      default: null,
      trim: true
    },

    // ✅ Explicit evaluation state (industry preferred)
    status: {
      type: String,
      enum: ["PENDING", "EVALUATED"],
      default: "PENDING"
    },

    evaluatedAt: {
      type: Date,
      default: null
    },

    monthlyAchievementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MonthlyAchievement",
      default: null
    }
  },
  {
    timestamps: true
  }
);

/* ===============================
   INDEXES (VERY IMPORTANT)
=============================== */

// Prevent duplicate evaluation per employee per month
monthlyEvaluationSchema.index(
  { employeeId: 1, month: 1 },
  { unique: true }
);

// Speed up RA dashboard queries
monthlyEvaluationSchema.index(
  { raId: 1, month: 1 }
);

module.exports = mongoose.model(
  "MonthlyEvaluation",
  monthlyEvaluationSchema
);
