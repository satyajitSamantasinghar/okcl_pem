const { DataTypes } = require("sequelize");

// NOTE: entityId in Mongoose was a generic ObjectId (polymorphic ref).
// In PostgreSQL there is no polymorphic FK, so we store it as a plain
// STRING alongside entityType — same data, fully queryable.

module.exports = (sequelize) => {
  const AuditLog = sequelize.define(
    "AuditLog",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      userId: {
        type:      DataTypes.UUID,
        allowNull: true,   // some system actions have no user
      },
      action: {
        type: DataTypes.STRING,
      },
      entityType: {
        type: DataTypes.STRING,
      },
      entityId: {
        type: DataTypes.STRING, // store the UUID/ID of any referenced entity as a string
      },
      ipAddress: {
        type: DataTypes.STRING,
      },
      timestamp: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName:   "audit_logs",
      underscored: true,
      timestamps:  false, // using our own `timestamp` column above
    }
  );

  return AuditLog;
};
