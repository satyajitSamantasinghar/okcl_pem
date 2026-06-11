const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const MonthlyEvaluation = sequelize.define(
    "MonthlyEvaluation",
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
        unique:    true, // ✅ one evaluation per plan (mirrors Mongoose unique: true)
      },
      raId: {
        type:      DataTypes.UUID,
        allowNull: true, // NULL when MD evaluates RA directly (evaluatorId is used instead)
      },
      month: {
        type:      DataTypes.STRING, // "2026-01"
        allowNull: false,
      },
      score: {
        type:     DataTypes.DECIMAL(5, 2),
        validate: { min: 0, max: 10 },
      },
      remarks: {
        type: DataTypes.TEXT,
      },
      status: {
        type:         DataTypes.ENUM("PENDING", "EVALUATED"),
        defaultValue: "PENDING",
      },
      evaluatedAt: {
        type: DataTypes.DATE,
      },
      monthlyAchievementId: {
        type:      DataTypes.UUID,
        allowNull: true,
      },
      // evaluatorId — set ONLY when the MD directly evaluates an RA's monthly plan.
      // In the normal EMPLOYEE→RA flow, this stays NULL and raId holds the evaluator.
      // When an RA's plan is evaluated by MD:  raId = NULL, evaluatorId = MD's userId.
      evaluatorId: {
        type:      DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName:   "monthly_evaluations",
      underscored: true,
      timestamps:  true, // createdAt + updatedAt
      indexes: [
        // NOTE: The old unique([employee_id, month]) index was removed.
        // An RA can have TWO rows: one as evaluatee (evaluatorId=MD) and one as
        // evaluator of their own employees (raId=<their id>). The composite
        // uniqueness is now enforced at the application layer in the controllers.
        // ✅ Speed up RA dashboard queries (ra_id column already exists — safe to index)
        { fields: ["ra_id", "month"] },
        // NOTE: evaluator_id index is intentionally omitted here.
        // Sequelize processes indexes before ALTER TABLE completes when the column
        // is new, which causes "column does not exist". The index can be added
        // manually via SQL after the first successful server start:
        //   CREATE INDEX IF NOT EXISTS monthly_evaluations_evaluator_id_month
        //     ON monthly_evaluations (evaluator_id, month);
      ],
    }
  );

  return MonthlyEvaluation;
};
