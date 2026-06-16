const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require("./routes/authRoutes");
const app = express();
const employeeRoutes = require("./routes/employeeRoutes");
const raRoutes = require("./routes/raRoutes");
const hrdRoutes = require("./routes/hrdRoutes");
const mdRoutes = require("./routes/mdRoutes");
// Since the React frontend is now served by this same Express server,
// all browser requests are same-origin and CORS headers are not needed.
// We keep cors() open for tools like Postman, mobile apps, or future integrations.
app.use(cors());

app.use(express.json());



app.get("/test-db", async (req, res) => {
    const { sequelize } = require("./models");
    try {
        await sequelize.authenticate();
        res.json({ message: "PostgreSQL connected and API working" });
    } catch (err) {
        res.status(500).json({ message: "PostgreSQL connection failed", error: err.message });
    }
});
const notificationRoutes = require("./routes/notificationRoutes");
app.use("/api/auth", authRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/ra", raRoutes);
app.use("/api/hrd", hrdRoutes);
app.use("/api/md", mdRoutes);
app.use("/api/notifications", notificationRoutes);

// ── Serve React frontend (must come AFTER all /api routes) ────────────────────
app.use(express.static(path.join(__dirname, '../dist')));

// Catch-all: for any non-API route, send back index.html so React Router works
// Note: Express 5 requires '/{*path}' syntax instead of '*'
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

module.exports = app;
