const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the revisionLog: [revisionLogSchema] embedded array
// in the Mongoose YearlyPlan schema.

module.exports = (sequelize) => {
  const YearlyPlanRevisionLog = sequelize.define(
    "YearlyPlanRevisionLog",
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
      version: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      revisedAt: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      reason: {
        type:      DataTypes.TEXT,
        allowNull: false,
      },
    },
    {
      tableName:   "yearly_plan_revision_logs",
      underscored: true,
      timestamps:  false,
    }
  );

  return YearlyPlanRevisionLog;
};
