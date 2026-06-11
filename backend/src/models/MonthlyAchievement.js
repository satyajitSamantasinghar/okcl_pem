const { DataTypes } = require("sequelize");

// planAchievements (array of sub-docs) → separate table MonthlyAchievementItem
//
// The pre-save hook that rebuilt achievementDetails from planAchievements is
// replaced by a Sequelize afterSave hook below, which does the same thing.

module.exports = (sequelize) => {
  const MonthlyAchievement = sequelize.define(
    "MonthlyAchievement",
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
      monthlyPlanId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      additionalAchievement: {
        type:         DataTypes.TEXT,
        defaultValue: "",
      },
      // Legacy summary field — rebuilt from MonthlyAchievementItems in the controller,
      // mirroring what the Mongoose pre-save hook did.
      achievementDetails: {
        type:         DataTypes.TEXT,
        defaultValue: "",
      },
      status: {
        type:         DataTypes.ENUM("DRAFT", "SUBMITTED"),
        defaultValue: "SUBMITTED",
      },
      submittedAt: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName:   "monthly_achievements",
      underscored: true,
      timestamps:  false,
    }
  );

  return MonthlyAchievement;
};
