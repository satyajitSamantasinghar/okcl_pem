const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const hrdController = require("../controllers/hrdController");

router.post(
  "/generate-yearly",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.generateYearlyAppraisal
);

router.post(
  "/review",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.hrdReview
);

module.exports = router;
