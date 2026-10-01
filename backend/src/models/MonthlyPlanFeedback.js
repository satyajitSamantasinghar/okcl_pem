const { DataTypes } = require("sequelize");

// NEW TABLE — supports the "RA feedback on an in-progress monthly plan"
// feature (Sep 2026). Deliberately NOT a status-machine (OPEN/RESOLVED/etc):
// this is a simple, immutable, timestamped remark thread, not a task the
// employee must formally close out. Multiple rows per MonthlyPlan are
// expected and normal — an RA can leave several remarks across the month.
//
// Why no status field: the feature only ever applies to the CURRENT,
// not-yet-evaluated month (see raController.submitPlanFeedback's window
// check, which reuses getEvaluationOpensAt — the same gate that unlocks
// Evaluate). Once evaluation unlocks for a month, that month's feedback
// thread is naturally frozen/historical — there is nothing left to
// "resolve" or "expire". The employee's response IS the plan/progress
// edit itself (visible to the RA directly on the plan), not a reply here.
//
// Why no edit/delete: feedback rows are an audit-style record of what the
// RA asked for and when. An RA who wants to revise guidance posts a new
// row rather than mutating history.

module.exports = (sequelize) => {
    const MonthlyPlanFeedback = sequelize.define(
        "MonthlyPlanFeedback",
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
            // The RA, or the MD when acting in RA-view on their direct report's plan.
            authorId: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            message: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
        },
        {
            tableName: "monthly_plan_feedback",
            underscored: true,
            // createdAt only — feedback is immutable once posted, so there is
            // deliberately no updatedAt to keep in sync.
            timestamps: true,
            updatedAt: false,
        }
    );

    return MonthlyPlanFeedback;
};