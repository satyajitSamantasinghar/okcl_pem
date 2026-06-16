const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/authMiddleware");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/hrms-sso", authController.hrmsSSO);       // ← HRMS redirect SSO
router.post("/refresh-token", authController.refreshAccessToken);
router.post("/logout", verifyToken, authController.logout);

module.exports = router;
