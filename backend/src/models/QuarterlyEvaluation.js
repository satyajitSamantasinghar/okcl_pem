const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const QuarterlyEvaluation = sequelize.define(
    "QuarterlyEvaluation",
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
      quarter: {
        type:      DataTypes.STRING, // "Q1-2026"
        allowNull: false,
      },
      raId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      averageScore: {
        type:      DataTypes.DECIMAL(5, 2),
        allowNull: false,
        validate:  { min: 0, max: 10 },
      },
      remarks: {
        type: DataTypes.TEXT,
      },
    },
    {
      tableName:   "quarterly_evaluations",
      underscored: true,
      timestamps:  true, // createdAt + updatedAt
      indexes: [
        // ✅ Prevent duplicate quarterly evaluations
        { unique: true, fields: ["employee_id", "quarter"] },
      ],
    }
  );

  return QuarterlyEvaluation;
};
