const express = require('express');
const cors = require('cors');
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


app.get('/', (req, res) => {
    res.send('PAS Backend Running');
});
app.get("/test-db", (req, res) => {
    res.json({ message: "MongoDB connected and API working" });
});
const notificationRoutes = require("./routes/notificationRoutes");
app.use("/api/auth", authRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/ra", raRoutes);
app.use("/api/hrd", hrdRoutes);
app.use("/api/md", mdRoutes);
app.use("/api/notifications", notificationRoutes);

module.exports = app;
