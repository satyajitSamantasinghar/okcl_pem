const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const raController = require("../controllers/raController");

router.post(
  "/monthly-evaluation",
  verifyToken,
  authorizeRoles("RA"),
  raController.submitMonthlyEvaluation
);

router.post(
  "/quarterly-evaluation",
  verifyToken,
  authorizeRoles("RA"),
  raController.generateQuarterlyEvaluation
);
router.get(
  "/monthly-evaluations",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  raController.getMonthlyEvaluations
);
router.get(
  "/quarterly-evaluations",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  raController.getQuarterlyEvaluations
);
router.get(
  "/monthly-evaluations/:id",
  verifyToken,
  authorizeRoles("RA","MD"),
  raController.getMonthlyEvaluationById
);


router.get(
  "/dashboard",
  verifyToken,
  authorizeRoles("RA"),
  raController.getRADashboard
);

router.get(
  "/quarterly-evaluations/:id",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  raController.getQuarterlyEvaluationById
);




module.exports = router;
