const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the kraAssessments: [kraAssessmentSchema] embedded
// array in the Mongoose YearlyAppraisalReport schema.
//
// description/target/timeline are denormalised copies (same as Mongoose) so
// the appraisal stays self-contained even if the source YearlyPlan is revised.
// kraIndex mirrors the 0-based position in YearlyPlanKra (since original kras
// used _id:false).

module.exports = (sequelize) => {
  const YearlyAppraisalKraAssessment = sequelize.define(
    "YearlyAppraisalKraAssessment",
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
      kraIndex: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      description: {
        type:      DataTypes.TEXT,
        allowNull: false,
      },
      target: {
        type:      DataTypes.TEXT,
        allowNull: false,
      },
      timeline: {
        type:      DataTypes.STRING,
        allowNull: false,
      },
      // Optional in DRAFT, required on SUBMIT — enforced in the controller
      achievement: {
        type:         DataTypes.TEXT,
        defaultValue: "",
      },
    },
    {
      tableName:   "yearly_appraisal_kra_assessments",
      underscored: true,
      timestamps:  false,
    }
  );

  return YearlyAppraisalKraAssessment;
};
