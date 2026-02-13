const mongoose = require("mongoose");

const quarterlyEvaluationSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    quarter: {
      type: String, // "Q1-2026"
      required: true
    },

    raId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    averageScore: {
      type: Number,
      min: 0,
      max: 10,
      required: true
    },

    remarks: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// ✅ Prevent duplicate quarterly evaluations
quarterlyEvaluationSchema.index(
  { employeeId: 1, quarter: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "QuarterlyEvaluation",
  quarterlyEvaluationSchema
);
