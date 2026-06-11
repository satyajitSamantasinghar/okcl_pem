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
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      monthlyAchievementId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      // 0-based index mirroring the parent MonthlyPlan's planItems order
      planIndex: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      achievementDetails: {
        type:         DataTypes.TEXT,
        defaultValue: "",
      },
      progress: {
        type:         DataTypes.INTEGER,
        defaultValue: 0,
        validate:     { min: 0, max: 100 },
      },
    },
    {
      tableName:   "monthly_achievement_items",
      underscored: true,
      timestamps:  false,
    }
  );

  return MonthlyAchievementItem;
};
