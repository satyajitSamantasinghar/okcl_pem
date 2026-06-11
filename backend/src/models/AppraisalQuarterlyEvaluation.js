const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the quarterlyEvaluations: [ObjectId] array in
// Mongoose YearlyAppraisalReport.
//
// In MongoDB this was an array of refs. In PostgreSQL it becomes a proper
// junction (join) table implementing a many-to-many relationship.

module.exports = (sequelize) => {
  const AppraisalQuarterlyEvaluation = sequelize.define(
    "AppraisalQuarterlyEvaluation",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      yearlyAppraisalReportId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      quarterlyEvaluationId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
    },
    {
      tableName:   "appraisal_quarterly_evaluations",
      underscored: true,
      timestamps:  false,
    }
  );

  return AppraisalQuarterlyEvaluation;
};
