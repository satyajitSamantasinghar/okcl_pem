const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
      },
      employeeCode: {
        type:      DataTypes.STRING,
        allowNull: false,
        unique:    true,
      },
      name: {
        type:      DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type:      DataTypes.STRING,
        allowNull: true,  // nullable: HRMS SSO may provide email after provisioning
        unique:    true,
        validate:  { isEmail: true },
      },
      passwordHash: {
        type:      DataTypes.STRING,
        allowNull: true,  // null for HRMS SSO users — password managed by HRMS
      },
      authProvider: {
        type:         DataTypes.STRING,
        allowNull:    false,
        defaultValue: "local",  // "local" | "hrms"
      },
      role: {
        type:      DataTypes.ENUM("EMPLOYEE", "RA", "HRD", "MD"),
        allowNull: false,
      },
      department: {
        type: DataTypes.STRING,
      },
      // Self-referencing FK — set in models/index.js associations
      reportingAuthorityId: {
        type:      DataTypes.UUID,
        allowNull: true,
      },
      refreshToken: {
        type: DataTypes.TEXT,
      },
      isActive: {
        type:         DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName:  "users",
      underscored: true,   // camelCase JS fields → snake_case DB columns
      timestamps:  true,   // createdAt + updatedAt
    }
  );

  return User;
};
