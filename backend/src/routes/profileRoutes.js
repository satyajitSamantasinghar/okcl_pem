// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE ROUTES
//  Mount in server.js / app.js as:  app.use("/api/profile", profileRoutes);
//
//  All routes require a valid JWT (verifyToken).
//  No role restriction — every authenticated user owns their own profile.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/authMiddleware");
const profileController = require("../controllers/profileController");

// GET    /api/profile/me              → Full profile + role-specific stats
router.get("/me", verifyToken, profileController.getMyProfile);

// PUT    /api/profile/me              → Update email / phone (whitelist-only)
router.put("/me", verifyToken, profileController.updateMyProfile);

// PUT    /api/profile/me/password     → Change password (local users only)
router.put("/me/password", verifyToken, profileController.changePassword);

// GET    /api/profile/me/activity     → Paginated audit log for this user
router.get("/me/activity", verifyToken, profileController.getMyActivity);

module.exports = router;
