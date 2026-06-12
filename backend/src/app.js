const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require("./routes/authRoutes");
const app = express();
const employeeRoutes = require("./routes/employeeRoutes");
const raRoutes = require("./routes/raRoutes");
const hrdRoutes = require("./routes/hrdRoutes");
const mdRoutes = require("./routes/mdRoutes");
app.use(cors(
    {
        origin: [
            "https://64wjr92x-5000.inc1.devtunnels.ms/ ",
            "http://localhost:5173"

        ]
    }
));

// app.use(cors({
//   origin: true,        // allow ALL origins (needed for devtunnels)
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));




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

app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

module.exports = app;
