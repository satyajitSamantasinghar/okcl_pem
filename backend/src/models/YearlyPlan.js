const { DataTypes } = require("sequelize");

// Three embedded arrays from Mongoose → three separate tables:
//   kras         → YearlyPlanKra
//   revisionLog  → YearlyPlanRevisionLog
//   editHistory  → YearlyPlanEditHistory

module.exports = (sequelize) => {
  const YearlyPlan = sequelize.define(
    "YearlyPlan",
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
      financialYear: {
        type:      DataTypes.STRING, // "2025-26"
        allowNull: false,
      },
      status: {
        type:         DataTypes.ENUM("DRAFT", "PENDING", "APPROVED", "REJECTED"),
        defaultValue: "DRAFT",
      },
      mdRemarks: {
        type:         DataTypes.TEXT,
        defaultValue: null,
      },
      version: {
        type:         DataTypes.INTEGER,
        defaultValue: 1,
      },
      submittedAt: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName:   "yearly_plans",
      underscored: true,
      timestamps:  true, // createdAt + updatedAt
      indexes: [
        // ✅ One yearly plan per employee per financial year
        { unique: true, fields: ["employee_id", "financial_year"] },
      ],
    }
  );

  return YearlyPlan;
};
