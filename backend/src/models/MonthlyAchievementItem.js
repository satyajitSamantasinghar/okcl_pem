const { DataTypes } = require("sequelize");

// NEW TABLE — replaces the planAchievements: [planAchievementSchema] embedded
// array in the Mongoose MonthlyAchievement schema.
//
// Each row = one achievement entry linked to a specific plan item by index.

module.exports = (sequelize) => {
  const MonthlyAchievementItem = sequelize.define(
    "MonthlyAchievementItem",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      monthlyAchievementId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Authoritative link to the specific MonthlyPlanItem this progress
      // entry reports on. Replaces positional (planIndex-based) matching —
      // see planIndex below for why that was fragile. Nullable only for
      // legacy rows written before this column existed and never backfilled
      // (e.g. a plan with no MonthlyPlanItem rows at all); every row created
      // going forward always sets this.
      planItemId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // 0-based index mirroring the parent MonthlyPlan's planItems order.
      // Kept for backward compatibility / audit trail only — planItemId
      // above is now the source of truth for which plan item this entry
      // belongs to. Do not use this for matching; a plan item's position
      // can change (e.g. items appended after submission), which is exactly
      // what made pure positional matching unreliable.
      planIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      achievementDetails: {
        type: DataTypes.TEXT,
        defaultValue: "",
      },
      progress: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0, max: 100 },
      },
      // Origin tracking for the "Add More Progress" mid-cycle feature —
      // distinguishes a progress entry submitted with the original
      // achievement from one appended later, after that achievement was
      // already SUBMITTED. Maps to DB column added_via (underscored below).
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
      tableName: "monthly_achievement_items",
      underscored: true,
      timestamps: false,
    }
  );

  return MonthlyAchievementItem;
};