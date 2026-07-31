const { DataTypes } = require("sequelize");

// ─────────────────────────────────────────────────────────────────────────────
//  DeadlineExtension model
//
//  WHY a dedicated table instead of relying solely on AuditLog:
//    • AuditLog is generic/schema-less (action + entityType + entityId strings).
//      It is the immutable, system-wide audit trail — never queried in hot paths.
//    • DeadlineExtension is a typed, compositely-indexed domain record that the
//      RAEmployeeDetailPage reads directly. It carries month, year, type,
//      oldDeadline, newDeadline, and reason as first-class columns.
//    • Both are written inside the same transaction on every extension — neither
//      replaces the other.
//
//  IMMUTABILITY CONTRACT:
//    • No UPDATE or DELETE route exists (or will ever be created) for this model.
//    • No soft-delete (paranoid) column — the record is the canonical truth.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = (sequelize) => {
  const DeadlineExtension = sequelize.define(
    "DeadlineExtension",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },

      // ── Who was extended ───────────────────────────────────────────────────
      employeeId: {
        type:      DataTypes.UUID,
        allowNull: false,
        // FK → users.id defined in models/index.js associations
      },

      // ── Who granted the extension (RA or MD acting as RA) ─────────────────
      extendedById: {
        type:      DataTypes.UUID,
        allowNull: false,
        // FK → users.id defined in models/index.js associations
      },

      // ── Which month/year this extension applies to ─────────────────────────
      month: {
        type:      DataTypes.INTEGER, // 1-12
        allowNull: false,
        validate:  { min: 1, max: 12 },
      },
      year: {
        type:      DataTypes.INTEGER,
        allowNull: false,
        validate:  { min: 2000, max: 2100 },
      },

      // ── Whether this extends the Plan deadline or the Achievement deadline ──
      type: {
        type:      DataTypes.ENUM("PLAN", "ACHIEVEMENT"),
        allowNull: false,
      },

      // ── The deadline before and after the extension ────────────────────────
      oldDeadline: {
        type:      DataTypes.DATEONLY, // DATE — no time component needed
        allowNull: false,
      },
      newDeadline: {
        type:      DataTypes.DATEONLY,
        allowNull: false,
      },

      // ── Mandatory justification text ──────────────────────────────────────
      reason: {
        type:      DataTypes.TEXT,
        allowNull: false,
        validate:  { len: [10, 2000] }, // mirrors frontend + controller validation
      },

      // ── Notification flag ─────────────────────────────────────────────────
      notifiedEmployee: {
        type:         DataTypes.BOOLEAN,
        allowNull:    false,
        defaultValue: true,
      },

      // ── Cross-reference to the AuditLog entry created in the same tx ──────
      // Nullable: allows older AuditLog entries (created before this model
      // existed) to coexist without orphan errors.
      auditLogId: {
        type:      DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName:   "deadline_extensions",
      underscored: true,   // camelCase JS → snake_case DB columns (matches all models)
      timestamps:  true,   // createdAt + updatedAt (stored in UTC)
      // No paranoid — audit records are immutable; deletion is never permitted.
      indexes: [
        // ── Primary query path: employee's extensions scoped by year + month ──
        // This is the exact composite filter used in getEmployeeDetail + FY tab.
        {
          name:   "deadline_extensions_employee_year_month",
          fields: ["employee_id", "year", "month"],
        },
        // ── Secondary: fast lookup by extender (RA/MD) ─────────────────────
        {
          name:   "deadline_extensions_extended_by_id",
          fields: ["extended_by_id"],
        },
      ],
    }
  );

  return DeadlineExtension;
};
