const { DataTypes } = require("sequelize");

// ─────────────────────────────────────────────────────────────────────────────
//  Manual model
//
//  One uploaded reference document (PDF) shown to employees/RAs as in-app
//  help — e.g. "How to use the Dashboard", "Monthly Plan & Progress guide".
//  Content and visibility are fully admin-managed.
//
//  FILE STORAGE
//    The PDF itself lives in OneDrive (see services/oneDriveService.js), not
//    on the API server's disk and not in this table. The row only stores a
//    pointer — driveId + driveItemId — which is stable even if someone
//    renames or moves the file inside OneDrive. The pointer is internal:
//    controllers strip it from every API response, and the file is only ever
//    served through manualController.js's downloadManual, which re-checks
//    isActive + role membership on every request.
//
//  MUTABILITY CONTRACT (unlike DeadlineExtension/ReminderLog, which are
//  immutable audit trails):
//    • Admin CAN update title/description/category/targetRoles, and CAN
//      replace the underlying file (the old OneDrive item is deleted — into
//      OneDrive's recycle bin — once the new one is safely saved).
//    • "Remove" is a soft toggle (isActive: false), not a DELETE — matches
//      the isActive convention already used for employee deactivation, so
//      removing a manual never orphans a file or breaks an AuditLog trail.
//
//  targetRoles is a Postgres text array (e.g. ['EMPLOYEE'], ['RA'], or both)
//  rather than a single-role column, so one manual can target more than one
//  role without a duplicate row. Validated in manualController.js against a
//  MANUAL_ROLES constant (mirrors adminController.js's ADMIN_TRACKED_ROLES
//  pattern), not a DB-level ENUM — adding a role (e.g. HRD) later needs no
//  migration.
//
//  fileType is a plain string, not an ENUM, for the same reason — PDF-only
//  today, but extending it later (see conversation re: PPT) is a validator
//  change, not a schema migration.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = (sequelize) => {
  const Manual = sequelize.define(
    "Manual",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      title: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { len: [1, 200] },
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { len: [1, 2000] },
      },

      // Free-text grouping (e.g. "Dashboard", "Monthly Plan & Progress").
      // The admin UI offers a curated suggestion list for consistency, but
      // this stays a plain string so a new category never needs a migration.
      category: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { len: [1, 100] },
      },

      // Which roles see this manual — validated in manualController.js
      // against MANUAL_ROLES, not a DB-level check.
      targetRoles: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        validate: { notEmpty: true },
      },

      // ── Stored file ─────────────────────────────────────────────────────
      fileName: {
        // Original uploaded filename, shown to the user and used as the
        // download name. The name inside OneDrive (storedFileName) is a
        // randomized UUID — never this one. See middleware/uploadMiddleware.js.
        type: DataTypes.STRING,
        allowNull: false,
      },

      // ── OneDrive reference (INTERNAL — never returned by the API) ───────
      driveId: {
        // The OneDrive/SharePoint drive holding the file. Stored per row (not
        // just read from env) so a row stays valid if the configured drive
        // ever changes — old files keep resolving to where they really are.
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      driveItemId: {
        // Graph's immutable id for the file. This — not a path — is what
        // downloads and deletes use.
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      storedFileName: {
        // The random "<uuid>.pdf" name inside OneDrive. Not used for lookups;
        // it lets an admin find the file when browsing the folder by hand.
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      fileType: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "PDF",
        validate: { isIn: [["PDF"]] }, // PDF-only for v1 — extend this list
        // AND the validation in uploadMiddleware.js together if PPT support
        // is added later.
      },
      fileSizeBytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      // Admin-controlled sort order within a category. Lower shows first.
      displayOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      // Soft-delete / hide-without-deleting — see MUTABILITY CONTRACT above.
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      uploadedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        // FK → users.id defined in models/index.js associations
      },
    },
    {
      tableName: "manuals",
      underscored: true,
      timestamps: true,
      indexes: [
        // Primary read path: listMyManuals filters active + role, groups by category
        {
          name: "manuals_is_active_category",
          fields: ["is_active", "category"],
        },
        // Two rows must never point at the same OneDrive file — replacing or
        // deleting the file for one would silently break the other.
        {
          name: "manuals_drive_item_id_unique",
          unique: true,
          fields: ["drive_item_id"],
        },
      ],
    }
  );

  return Manual;
};