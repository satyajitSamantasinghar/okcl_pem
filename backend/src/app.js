const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require("./routes/authRoutes");
const app = express();
const employeeRoutes = require("./routes/employeeRoutes");
const raRoutes = require("./routes/raRoutes");
const hrdRoutes = require("./routes/hrdRoutes");
const mdRoutes = require("./routes/mdRoutes");
const profileRoutes = require("./routes/profileRoutes");
const notificationRoutes = require("./routes/notificationRoutes");


// ── CORS ─────────────────────────────────────────────────────────────────────
// Production  → frontend is served by this same Express server (same origin),
//               so ALLOWED_ORIGINS is left empty and CORS is effectively a no-op.
// Development → Vite dev server runs on a different port; set ALLOWED_ORIGINS
//               in your local .env so credentialed requests are accepted.
//               Example:  ALLOWED_ORIGINS=http://localhost:5173
// ─────────────────────────────────────────────────────────────────────────────
// const allowedOrigins = process.env.ALLOWED_ORIGINS
//     ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
//     : [];

// app.use(cors({
//     origin: (origin, callback) => {
//         // Allow server-to-server / Postman calls (no Origin header)
//         if (!origin) return callback(null, true);
//         if (allowedOrigins.includes(origin)) return callback(null, true);
//         callback(new Error(`CORS: origin '${origin}' not allowed`));
//     },
//     credentials: true,   // lets the browser send cookies / Authorization headers
// }));
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
app.use("/api/auth", authRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/ra", raRoutes);
app.use("/api/hrd", hrdRoutes);
app.use("/api/md", mdRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/profile", profileRoutes);

// ── Serve React frontend (must come AFTER all /api routes) ────────────────────
app.use(express.static(path.join(__dirname, '../dist')));

// Catch-all: for any non-API route, send back index.html so React Router works
// Note: Express 5 requires '/{*path}' syntax instead of '*'
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

module.exports = app;
