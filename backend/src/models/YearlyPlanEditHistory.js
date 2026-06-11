const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the editHistory: [...] embedded array in the
// Mongoose YearlyPlan schema.
// Kept for backward-compat / audit as noted in the original model.

module.exports = (sequelize) => {
  const YearlyPlanEditHistory = sequelize.define(
    "YearlyPlanEditHistory",
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
      editedAt: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      previousStatus: {
        type: DataTypes.STRING,
      },
      note: {
        type: DataTypes.TEXT,
      },
    },
    {
      tableName:   "yearly_plan_edit_histories",
      underscored: true,
      timestamps:  false,
    }
  );

  return YearlyPlanEditHistory;
};
