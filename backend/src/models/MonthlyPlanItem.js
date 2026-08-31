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
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      monthlyPlanId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      itemText: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      itemOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Origin tracking for the "Add More Plans" mid-cycle feature —
      // distinguishes an item submitted with the original monthly plan
      // from one appended later, after that plan was already PENDING.
      // Maps to DB column added_via (underscored: true below).
      addedVia: {
        type: DataTypes.ENUM("INITIAL_SUBMISSION", "ADD_MORE"),
        allowNull: false,
        defaultValue: "INITIAL_SUBMISSION",
      },
      // When this specific row was created. Kept as an explicit column
      // (not relied on via a createdAt timestamp) because this model has
      // timestamps disabled below. Maps to DB column added_at.
      addedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "monthly_plan_items",
      underscored: true,
      timestamps: false,
    }
  );

  return MonthlyPlanItem;
};