const { DataTypes } = require("sequelize");

// planItems (array of strings) is extracted into a separate table: MonthlyPlanItem.
// planDetails (the joined string) is still stored here for backward-compat with
// RA / admin views — it is re-derived in the controller whenever planItems are saved,
// replacing the pre-save Mongoose hook.

module.exports = (sequelize) => {
  const MonthlyPlan = sequelize.define(
    "MonthlyPlan",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      month: {
        type: DataTypes.STRING, // "2026-01"
        allowNull: false,
      },
      planDetails: {
        type: DataTypes.TEXT,   // auto-derived from planItems in the controller
        allowNull: false,
        defaultValue: "",
      },
      status: {
        type: DataTypes.ENUM("DRAFT", "PENDING", "APPROVED", "REJECTED"),
        defaultValue: "PENDING",
      },
      mdRemarks: {
        type: DataTypes.TEXT,
      },
      raRemarks: {
        type: DataTypes.TEXT,
      },
      version: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: true, // only ever set by the controller when status actually becomes PENDING
      },
    },
    {
      tableName: "monthly_plans",
      underscored: true,
      timestamps: false,
      indexes: [
        // Replaces Mongoose: one plan per employee per month
        { unique: true, fields: ["employee_id", "month"] },
      ],
    }
  );

  return MonthlyPlan;
};