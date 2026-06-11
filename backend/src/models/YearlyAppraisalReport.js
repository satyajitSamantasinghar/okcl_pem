const { DataTypes } = require("sequelize");

// Two embedded arrays from Mongoose → two separate tables:
//   kraAssessments        → YearlyAppraisalKraAssessment
//   quarterlyEvaluations  → AppraisalQuarterlyEvaluation (junction table)

module.exports = (sequelize) => {
  const YearlyAppraisalReport = sequelize.define(
    "YearlyAppraisalReport",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      employeeId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      // null for mid-year hires with no approved yearly plan
      linkedYearlyPlanId: {
        type:         DataTypes.UUID,
        allowNull:    true,
        defaultValue: null,
      },
      financialYear: {
        type:      DataTypes.STRING, // "2025-26"
        allowNull: false,
      },
      additionalAssignments: {
        type:         DataTypes.TEXT,
        defaultValue: null,
      },

      /* ── RA EVALUATION (max 80) ── */
      raWorkKraScore:         { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      raAdditionalScore:      { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      raPersonalAttributes:   { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      raTeamAttributes:       { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      raLeadershipAttributes: { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      raTotalScore:           { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      raRemarks:              { type: DataTypes.TEXT,          defaultValue: null },
      raEvaluatedAt:          { type: DataTypes.DATE,          defaultValue: null },

      /* ── HRD EVALUATION (max 5) ── */
      hrdOfficeTimeDiscipline: { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      hrdLeaveTraits:          { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      hrdTotalScore:           { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      hrdRemarks:              { type: DataTypes.TEXT,          defaultValue: null },
      hrdEvaluatedAt:          { type: DataTypes.DATE,          defaultValue: null },

      /* ── MD FINAL EVALUATION (max 15) ── */
      mdFinalScore:  { type: DataTypes.DECIMAL(5, 2), defaultValue: null },
      mdRemarks:     { type: DataTypes.TEXT,          defaultValue: null },
      mdEvaluatedAt: { type: DataTypes.DATE,          defaultValue: null },

      /* Grand total (max 100) — auto-computed when all three evaluations are done */
      grandTotal: { type: DataTypes.DECIMAL(5, 2), defaultValue: null },

      status: {
        type: DataTypes.ENUM(
          "DRAFT",
          "SUBMITTED",
          "RA_EVALUATED",
          "HRD_EVALUATED",
          "MD_EVALUATED",
          "COMPLETED"
        ),
        defaultValue: "SUBMITTED",
      },
      submittedAt: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName:   "yearly_appraisal_reports",
      underscored: true,
      timestamps:  true, // createdAt + updatedAt
      indexes: [
        // ✅ One appraisal report per employee per financial year
        { unique: true, fields: ["employee_id", "financial_year"] },
      ],
    }
  );

  return YearlyAppraisalReport;
};
