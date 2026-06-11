const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Notification = sequelize.define(
    "Notification",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      userId: {
        type:      DataTypes.UUID,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM(
          "MONTHLY_PLAN_REJECTED",
          "YEARLY_PLAN_REJECTED",
          "YEARLY_PLAN_APPROVED",
          "MONTHLY_EVALUATED",
          "QUARTERLY_EVALUATED",
          "YEARLY_REPORT_EVALUATED",
          "GENERAL"
        ),
        allowNull: false,
      },
      title: {
        type:      DataTypes.STRING,
        allowNull: false,
      },
      message: {
        type:      DataTypes.TEXT,
        allowNull: false,
      },
      entityType: {
        type: DataTypes.STRING,
      },
      entityId: {
        type: DataTypes.STRING, // polymorphic ref stored as string (same as AuditLog)
      },
      read: {
        type:         DataTypes.BOOLEAN,
        defaultValue: false,
      },
      createdAt: {
        type:         DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName:   "notifications",
      underscored: true,
      timestamps:  false,
      // Replaces Mongoose index: { userId: 1, read: 1, createdAt: -1 }
      indexes: [
        { fields: ["user_id", "read", "created_at"] },
      ],
    }
  );

  return Notification;
};
