const { DataTypes } = require("sequelize");

// ─────────────────────────────────────────────────────────────────────────────
//  UserStatusHistory (user_status_histories)
//
//  Purpose: complete audit trail of a user's isActive transitions over time —
//  the same role EmployeeRAHistory plays for RA reassignments, applied to
//  activation/deactivation instead.
//
//  Why this exists: User.isActive is a live, point-in-time snapshot. It can
//  correctly answer "is this person active right now?" but NOT "was this
//  person active during month M?" — the moment someone is deactivated, every
//  query that filters on the live isActive column silently stops counting
//  them for PAST months too, even months where they were genuinely active
//  and submitted real data. This table makes "active during month M" a
//  first-class, queryable fact instead of an assumption.
//
//  Row shape: one row per continuous stretch of a given isActive value.
//  effectiveTo: null means the row is the CURRENTLY open/in-effect one.
//  Deactivating then reactivating then deactivating again produces three
//  rows, each with its own effectiveFrom/effectiveTo — this is what lets the
//  table (unlike a single "deactivatedAt" column) correctly answer queries
//  across multiple activate/deactivate cycles.
//
//  Written transactionally by adminController.js's updateEmployeeStatus:
//  closes the currently-open row (effectiveTo = now) and inserts a new one,
//  every time isActive is flipped. Read by utils/userStatusHistory.js's
//  filterActiveDuringMonth(), the single shared helper every month-scoped
//  controller query should use instead of re-deriving this condition.
//
//  Backfilled once for pre-existing users by server.js's
//  backfillUserStatusHistory() — see that function's header comment for the
//  seeding rule (effectiveFrom = user.createdAt).
// ─────────────────────────────────────────────────────────────────────────────

module.exports = (sequelize) => {
    const UserStatusHistory = sequelize.define(
        "UserStatusHistory",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            userId: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            isActive: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
            },
            effectiveFrom: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            effectiveTo: {
                type: DataTypes.DATE,
                allowNull: true, // NULL = currently in effect
            },
            // Who performed the toggle. Nullable: the one-time backfill row for a
            // pre-existing user has no known actor (mirrors EmployeeRAHistory's
            // assignedBy: null for its own pre-history backfill).
            changedBy: {
                type: DataTypes.UUID,
                allowNull: true,
            },
        },
        {
            tableName: "user_status_histories",
            underscored: true,
            timestamps: true,
        }
    );

    return UserStatusHistory;
};