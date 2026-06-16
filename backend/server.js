
const dotenv = require('dotenv');
dotenv.config();
const app = require("./src/app");
const { sequelize } = require("./src/models");
const { DataTypes } = require("sequelize");


const PORT = process.env.PORT || 5000;


// ─── DB Migrations ────────────────────────────────────────────────────────────
//  Safe, idempotent column-level migrations using queryInterface.
//  These run BEFORE sequelize.sync() on every startup.
//  Each migration checks if the change is already applied before touching the DB,
//  so it is safe to deploy and restart multiple times without side effects.
//  Add new migrations here when schema changes are needed; never use alter:true.
// ─────────────────────────────────────────────────────────────────────────────
const runMigrations = async () => {
    const qi = sequelize.getQueryInterface();
    const tableDesc = await qi.describeTable("users");

    // Migration 1: Add auth_provider column (needed for HRMS SSO integration)
    if (!tableDesc.auth_provider) {
        await qi.addColumn("users", "auth_provider", {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: "local",  // existing rows get "local" (password-based)
        });
        console.log("✅ Migration: added auth_provider column to users table");
    }

    // Migration 2: Allow password_hash to be NULL (HRMS SSO users have no local password)
    if (tableDesc.password_hash && tableDesc.password_hash.allowNull === false) {
        await qi.changeColumn("users", "password_hash", {
            type: DataTypes.STRING,
            allowNull: true,
        });
        console.log("✅ Migration: password_hash column set to nullable");
    }
};


// ─── STEP 3: async startup — connect DB first, then start server ──────────
const startServer = async () => {
    try {
        // Test the PostgreSQL connection
        await sequelize.authenticate();
        console.log("✅ PostgreSQL connected successfully");

        // Run schema migrations before syncing
        await runMigrations();

        // Sync models → tables
        // alter: true  → ⚠️  AVOID: drops & re-adds FK constraints every restart,
        //                    causing "Unknown constraint" errors in PostgreSQL.
        // force: true  → DROPS and recreates all tables (destructive — dev only).
        // sync()       → ✅ safe: creates missing tables, never touches existing ones.
        await sequelize.sync();   // no alter — schema is already correct
        console.log("✅ All tables synced");

        // Start server only after DB is ready
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("❌ Startup failed:", error.message);
        process.exit(1);  // stop the process if DB fails
    }
};

startServer();



