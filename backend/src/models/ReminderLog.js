const { DataTypes } = require("sequelize");

// ─────────────────────────────────────────────────────────────────────────────
//  ReminderLog model
//
//  WHY a dedicated table instead of overloading AuditLog:
//    Same rationale as DeadlineExtension.js — AuditLog is the generic,
//    schema-less, system-wide audit trail (action + entityType + entityId
//    strings), not meant for hot, structured, directly-queried data.
//    ReminderLog is queried on every reminder job run (dedup check before
//    every send) with a composite filter — that belongs in its own typed,
//    indexed table, not layered on top of AuditLog's generic shape.
//
//  DEDUP CONTRACT:
//    One row per (employeeId, month, type, thresholdDays) — enforced by a
//    unique index, not just application-level checks, so a reminder can
//    never be sent twice for the same record/threshold even if the cron
//    job overlaps itself or runs on two instances at once. See
//    reminderService.js's recordSent(), which relies on this constraint
//    to make concurrent inserts safe without a transaction.
//
//  IMMUTABILITY CONTRACT:
//    No UPDATE or DELETE route exists (or will ever be created) for this
//    model, matching DeadlineExtension's contract — a reminder log entry
//    is a fact about what was sent, not a mutable status flag.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = (sequelize) => {
    const ReminderLog = sequelize.define(
        "ReminderLog",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },

            // ── Who the reminder was for ───────────────────────────────────────────
            employeeId: {
                type: DataTypes.UUID,
                allowNull: false,
                // FK → users.id defined in models/index.js associations
            },

            // ── Which record-month this reminder concerns ("YYYY-MM") ─────────────
            // For PLAN this is the current calendar month; for ACHIEVEMENT this is
            // the linked MonthlyPlan's own month (may be a prior month — the
            // achievement window is month-flexible, see dateHelpers.js's
            // computeAchievementWindow).
            month: {
                type: DataTypes.STRING,
                allowNull: false,
            },

            // ── Which submission this reminder was about ───────────────────────────
            type: {
                type: DataTypes.ENUM("PLAN", "ACHIEVEMENT"),
                allowNull: false,
            },

            // ── Which configured threshold (days before the effective deadline)
            //    triggered this specific reminder, e.g. 3 or 1. Part of the unique
            //    key so an employee can legitimately receive one reminder per
            //    configured threshold (e.g. a 3-day AND a 1-day reminder), never
            //    two for the same threshold. ─────────────────────────────────────
            thresholdDays: {
                type: DataTypes.INTEGER,
                allowNull: false,
                validate: { min: 0 },
            },

            // ── Snapshot of the effective deadline (incl. any RA extension) at
            //    the moment this reminder was sent — audit/debug trail so a
            //    later "why did/didn't this reminder fire" question doesn't
            //    require recomputing historical config. ─────────────────────────
            effectiveDeadline: {
                type: DataTypes.DATE,
                allowNull: false,
            },

            sentAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            tableName: "reminder_logs",
            underscored: true,
            timestamps: false,
            // No paranoid — reminder logs are immutable; deletion is never permitted.
            indexes: [
                // ── Dedup key + primary query path (see recordSent/alreadySent in
                //    reminderService.js) ──────────────────────────────────────────
                {
                    unique: true,
                    name: "reminder_logs_employee_month_type_threshold",
                    fields: ["employee_id", "month", "type", "threshold_days"],
                },
            ],
        }
    );

    return ReminderLog;
};