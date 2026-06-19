const { DataTypes } = require("sequelize");

// ─────────────────────────────────────────────────────────────────────────────
//  EmployeeRAHistory
//
//  Records every RA-assignment event for an employee.
//  This is the source of truth for "which RA held this employee during month X".
//
//  A new row is inserted whenever HRD reassigns an employee:
//    - The previous open row (effectiveTo IS NULL) is closed with effectiveTo = NOW().
//    - A new row is inserted with effectiveFrom = NOW(), effectiveTo = NULL.
//
//  The dashboard queries this table with a date-overlap check:
//    effectiveFrom <= endOfMonth  AND  (effectiveTo IS NULL OR effectiveTo > startOfMonth)
//  This gives the correct employee roster for any historical month, and also
//  counts an employee under BOTH RAs if they were transferred mid-month
//  (intentional overlap approach, per product spec).
// ─────────────────────────────────────────────────────────────────────────────

module.exports = (sequelize) => {
  const EmployeeRAHistory = sequelize.define(
    "EmployeeRAHistory",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      employeeId: {
        type:      DataTypes.UUID,
        allowNull: false,
        comment:   "The employee being assigned (FK → users.id)",
      },
      raId: {
        type:      DataTypes.UUID,
        allowNull: false,
        comment:   "The Reporting Authority this employee was assigned to (FK → users.id)",
      },
      effectiveFrom: {
        type:      DataTypes.DATE,
        allowNull: false,
        comment:   "When this assignment started (set to NOW() on creation)",
      },
      effectiveTo: {
        type:      DataTypes.DATE,
        allowNull: true,
        comment:   "When this assignment ended (NULL = currently active). Closed when employee is reassigned.",
      },
      assignedBy: {
        type:      DataTypes.UUID,
        allowNull: true,
        comment:   "UUID of the HRD/admin user who created this assignment (FK → users.id). NULL for system/backfill rows.",
      },
    },
    {
      tableName:   "employee_ra_histories",
      underscored: true,
      timestamps:  true,
      indexes: [
        // Fast lookup: "which employees does RA X have in month Y?"
        { fields: ["ra_id", "effective_from", "effective_to"] },
        // Fast lookup: "what is the current RA for employee Z?"
        { fields: ["employee_id", "effective_to"] },
      ],
    }
  );

  return EmployeeRAHistory;
};
