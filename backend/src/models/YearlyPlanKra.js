const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the kras: [kraSchema] embedded array in the
// Mongoose YearlyPlan schema.
//
// kraIndex preserves order and is also used by YearlyAppraisalReport's
// kraAssessments to reference the correct KRA (since the Mongoose kras
// used _id:false — no ObjectId — we keep the same index-based reference).

module.exports = (sequelize) => {
  const YearlyPlanKra = sequelize.define(
    "YearlyPlanKra",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      yearlyPlanId: {
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
    },
    {
      tableName:   "yearly_plan_kras",
      underscored: true,
      timestamps:  false,
    }
  );

  return YearlyPlanKra;
};
