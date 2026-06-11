const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the planItems: [String] embedded array in the
// Mongoose MonthlyPlan schema.
//
// Each row = one plan item (one text box the employee filled in).
// itemOrder preserves the original array index so the UI renders items
// in the correct sequence.

module.exports = (sequelize) => {
  const MonthlyPlanItem = sequelize.define(
    "MonthlyPlanItem",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      monthlyPlanId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      itemText: {
        type:      DataTypes.TEXT,
        allowNull: false,
      },
      itemOrder: {
        type:         DataTypes.INTEGER,
        allowNull:    false,
        defaultValue: 0,
      },
    },
    {
      tableName:   "monthly_plan_items",
      underscored: true,
      timestamps:  false,
    }
  );

  return MonthlyPlanItem;
};
