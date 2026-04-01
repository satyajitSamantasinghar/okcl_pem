const mongoose = require("mongoose");

const yearlyAppraisalReportSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    yearlyPlanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "YearlyPlan"
    },

    financialYear: {
        type: String, // "2025-26"
        required: true
    },

    /* ----- Employee Self-Assessment ----- */
    workKRA: {
        type: String, // Work done against KRA
        required: true
    },

    additionalAssignments: {
        type: String // Additional work beyond plan
    },

    /* =====================================================
       RA EVALUATION (Total out of 80)
       Sub-categories: no fixed individual limits,
       but sum must not exceed 80
    ===================================================== */
    raWorkKRAScore: { type: Number, default: null },
    raAdditionalScore: { type: Number, default: null },
    raPersonalAttributes: { type: Number, default: null },
    raTeamAttributes: { type: Number, default: null },
    raLeadershipAttributes: { type: Number, default: null },
    raTotalScore: { type: Number, default: null }, // sum, max 80
    raRemarks: String,
    raEvaluatedAt: Date,

    /* =====================================================
       HRD EVALUATION (Total out of 5)
       Sub-categories: no fixed individual limits,
       but sum must not exceed 5
    ===================================================== */
    hrdOfficeTimeDiscipline: { type: Number, default: null },
    hrdLeaveTraits: { type: Number, default: null },
    hrdTotalScore: { type: Number, default: null }, // sum, max 5
    hrdRemarks: String,
    hrdEvaluatedAt: Date,

    /* =====================================================
       MD FINAL EVALUATION (out of 15)
    ===================================================== */
    mdFinalScore: { type: Number, default: null }, // max 15
    mdRemarks: String,
    mdEvaluatedAt: Date,

    /* Grand total (max 100) */
    grandTotal: { type: Number, default: null },

    /* ----- Quarterly refs (auto-populated) ----- */
    quarterlyEvaluations: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "QuarterlyEvaluation"
        }
    ],

    status: {
        type: String,
        enum: ["SUBMITTED", "RA_EVALUATED", "HRD_EVALUATED", "MD_EVALUATED", "COMPLETED"],
        default: "SUBMITTED"
    },

    submittedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

yearlyAppraisalReportSchema.index({ employeeId: 1, financialYear: 1 }, { unique: true });

module.exports = mongoose.model("YearlyAppraisalReport", yearlyAppraisalReportSchema);
