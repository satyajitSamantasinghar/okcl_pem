const sequelize = require("../config/database");

// ─────────────────────────────────────────────────────────────
//  Register every model
// ─────────────────────────────────────────────────────────────
const User                          = require("./User")(sequelize);
const AuditLog                      = require("./AuditLog")(sequelize);
const Notification                  = require("./Notification")(sequelize);
const MonthlyPlan                   = require("./MonthlyPlan")(sequelize);
const MonthlyPlanItem               = require("./MonthlyPlanItem")(sequelize);
const MonthlyAchievement            = require("./MonthlyAchievement")(sequelize);
const MonthlyAchievementItem        = require("./MonthlyAchievementItem")(sequelize);
const MonthlyEvaluation             = require("./MonthlyEvaluation")(sequelize);
const QuarterlyEvaluation           = require("./QuarterlyEvaluation")(sequelize);
const YearlyPlan                    = require("./YearlyPlan")(sequelize);
const YearlyPlanKra                 = require("./YearlyPlanKra")(sequelize);
const YearlyPlanRevisionLog         = require("./YearlyPlanRevisionLog")(sequelize);
const YearlyPlanEditHistory         = require("./YearlyPlanEditHistory")(sequelize);
const YearlyAppraisalReport         = require("./YearlyAppraisalReport")(sequelize);
const YearlyAppraisalKraAssessment  = require("./YearlyAppraisalKraAssessment")(sequelize);
const AppraisalQuarterlyEvaluation  = require("./AppraisalQuarterlyEvaluation")(sequelize);

// ─────────────────────────────────────────────────────────────
//  ASSOCIATIONS
//  Rule: always define BOTH sides of every relationship.
//        FK columns are inferred from foreignKey option.
// ─────────────────────────────────────────────────────────────

/* ── User ↔ User (self-referencing) ── */
User.belongsTo(User, {
  as:         "reportingAuthority",
  foreignKey: "reportingAuthorityId",
});
User.hasMany(User, {
  as:         "subordinates",
  foreignKey: "reportingAuthorityId",
});

/* ── AuditLog ↔ User ── */
AuditLog.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(AuditLog,   { as: "auditLogs", foreignKey: "userId" });

/* ── Notification ↔ User ── */
Notification.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(Notification,   { as: "notifications", foreignKey: "userId" });

/* ── MonthlyPlan ↔ User ── */
MonthlyPlan.belongsTo(User, { as: "employee", foreignKey: "employeeId" });
User.hasMany(MonthlyPlan,   { as: "monthlyPlans", foreignKey: "employeeId" });

/* ── MonthlyPlanItem ↔ MonthlyPlan ── */
MonthlyPlan.hasMany(MonthlyPlanItem, {
  as:         "planItems",
  foreignKey: "monthlyPlanId",
  onDelete:   "CASCADE",
});
MonthlyPlanItem.belongsTo(MonthlyPlan, { foreignKey: "monthlyPlanId" });

/* ── MonthlyAchievement ↔ User & MonthlyPlan ── */
MonthlyAchievement.belongsTo(User, {
  as:         "employee",
  foreignKey: "employeeId",
});
MonthlyAchievement.belongsTo(MonthlyPlan, {
  as:         "monthlyPlan",
  foreignKey: "monthlyPlanId",
});
MonthlyPlan.hasOne(MonthlyAchievement, {
  as:         "achievement",
  foreignKey: "monthlyPlanId",
});

/* ── MonthlyAchievementItem ↔ MonthlyAchievement ── */
MonthlyAchievement.hasMany(MonthlyAchievementItem, {
  as:         "planAchievements",
  foreignKey: "monthlyAchievementId",
  onDelete:   "CASCADE",
});
MonthlyAchievementItem.belongsTo(MonthlyAchievement, {
  foreignKey: "monthlyAchievementId",
});

/* ── MonthlyEvaluation ↔ User, MonthlyPlan, MonthlyAchievement ── */
MonthlyEvaluation.belongsTo(User, { as: "employee",           foreignKey: "employeeId" });
MonthlyEvaluation.belongsTo(User, { as: "ra",                 foreignKey: "raId" });
// evaluatorId — used when MD directly evaluates an RA (raId is null in that case)
MonthlyEvaluation.belongsTo(User, { as: "evaluator",          foreignKey: "evaluatorId" });
MonthlyEvaluation.belongsTo(MonthlyPlan, {
  as:         "monthlyPlan",
  foreignKey: "monthlyPlanId",
});
MonthlyEvaluation.belongsTo(MonthlyAchievement, {
  as:         "monthlyAchievement",
  foreignKey: "monthlyAchievementId",
});

/* ── QuarterlyEvaluation ↔ User ── */
QuarterlyEvaluation.belongsTo(User, { as: "employee", foreignKey: "employeeId" });
QuarterlyEvaluation.belongsTo(User, { as: "ra",       foreignKey: "raId" });
User.hasMany(QuarterlyEvaluation, { as: "quarterlyEvaluationsAsEmployee", foreignKey: "employeeId" });
User.hasMany(QuarterlyEvaluation, { as: "quarterlyEvaluationsAsRa",       foreignKey: "raId" });

/* ── YearlyPlan ↔ User ── */
YearlyPlan.belongsTo(User, { as: "employee", foreignKey: "employeeId" });
User.hasMany(YearlyPlan,   { as: "yearlyPlans", foreignKey: "employeeId" });

/* ── YearlyPlanKra ↔ YearlyPlan ── */
YearlyPlan.hasMany(YearlyPlanKra, {
  as:         "kras",
  foreignKey: "yearlyPlanId",
  onDelete:   "CASCADE",
});
YearlyPlanKra.belongsTo(YearlyPlan, { foreignKey: "yearlyPlanId" });

/* ── YearlyPlanRevisionLog ↔ YearlyPlan ── */
YearlyPlan.hasMany(YearlyPlanRevisionLog, {
  as:         "revisionLog",
  foreignKey: "yearlyPlanId",
  onDelete:   "CASCADE",
});
YearlyPlanRevisionLog.belongsTo(YearlyPlan, { foreignKey: "yearlyPlanId" });

/* ── YearlyPlanEditHistory ↔ YearlyPlan ── */
YearlyPlan.hasMany(YearlyPlanEditHistory, {
  as:         "editHistory",
  foreignKey: "yearlyPlanId",
  onDelete:   "CASCADE",
});
YearlyPlanEditHistory.belongsTo(YearlyPlan, { foreignKey: "yearlyPlanId" });

/* ── YearlyAppraisalReport ↔ User & YearlyPlan ── */
YearlyAppraisalReport.belongsTo(User, { as: "employee", foreignKey: "employeeId" });
User.hasMany(YearlyAppraisalReport,   { as: "appraisalReports", foreignKey: "employeeId" });
YearlyAppraisalReport.belongsTo(YearlyPlan, {
  as:         "linkedYearlyPlan",
  foreignKey: "linkedYearlyPlanId",
});

/* ── YearlyAppraisalKraAssessment ↔ YearlyAppraisalReport ── */
YearlyAppraisalReport.hasMany(YearlyAppraisalKraAssessment, {
  as:         "kraAssessments",
  foreignKey: "yearlyAppraisalReportId",
  onDelete:   "CASCADE",
});
YearlyAppraisalKraAssessment.belongsTo(YearlyAppraisalReport, {
  foreignKey: "yearlyAppraisalReportId",
});

/* ── YearlyAppraisalReport ↔ QuarterlyEvaluation (many-to-many via junction) ── */
YearlyAppraisalReport.belongsToMany(QuarterlyEvaluation, {
  through:    AppraisalQuarterlyEvaluation,
  as:         "quarterlyEvaluations",
  foreignKey: "yearlyAppraisalReportId",
  otherKey:   "quarterlyEvaluationId",
});
QuarterlyEvaluation.belongsToMany(YearlyAppraisalReport, {
  through:    AppraisalQuarterlyEvaluation,
  as:         "appraisalReports",
  foreignKey: "quarterlyEvaluationId",
  otherKey:   "yearlyAppraisalReportId",
});

// ─────────────────────────────────────────────────────────────
//  Export everything so controllers can do:
//  const { User, MonthlyPlan, ... } = require('../models');
// ─────────────────────────────────────────────────────────────
module.exports = {
  sequelize,
  User,
  AuditLog,
  Notification,
  MonthlyPlan,
  MonthlyPlanItem,
  MonthlyAchievement,
  MonthlyAchievementItem,
  MonthlyEvaluation,
  QuarterlyEvaluation,
  YearlyPlan,
  YearlyPlanKra,
  YearlyPlanRevisionLog,
  YearlyPlanEditHistory,
  YearlyAppraisalReport,
  YearlyAppraisalKraAssessment,
  AppraisalQuarterlyEvaluation,
};
