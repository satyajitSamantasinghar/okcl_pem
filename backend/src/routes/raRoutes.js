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
  authorizeRoles("RA", "MD"),
  raController.getMonthlyEvaluationById
);


router.get(
  "/dashboard",
  verifyToken,
  authorizeRoles("RA"),
  raController.getRADashboard
);

router.get(
  "/monthly-trend",
  verifyToken,
  authorizeRoles("RA"),
  raController.getMonthlyTrend
);
router.get(
  "/my-employees",
  verifyToken,
  authorizeRoles("RA"),
  raController.getMyEmployees
);

router.get(
  "/employee/:id",
  verifyToken,
  authorizeRoles("RA"),
  raController.getEmployeeDetail
);

router.get(
  "/quarterly-evaluations/:id",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  raController.getQuarterlyEvaluationById
);

router.get(
  "/quarterly-evaluations/:id/detail",
  verifyToken,
  authorizeRoles("RA", "HRD", "MD"),
  raController.getQuarterlyDetail
);

router.put(
  "/quarterly-evaluations/:id/remarks",
  verifyToken,
  authorizeRoles("RA"),
  raController.updateQuarterlyRemarks
);

/* Yearly Appraisal Report Evaluation */
router.put(
  "/yearly-report/:id",
  verifyToken,
  authorizeRoles("RA"),
  raController.evaluateYearlyReport
);

/* Yearly Plans */
router.get(
  "/yearly-plans",
  verifyToken,
  authorizeRoles("RA"),
  raController.getYearlyPlans
);

/* Yearly Reports */
router.get(
  "/yearly-reports",
  verifyToken,
  authorizeRoles("RA"),
  raController.getYearlyReports
);




router.get("/quarterly-evaluations/:id/full-detail",
  verifyToken,
  authorizeRoles("RA", "HRD", "MD"),
  raController.getQuarterlyFullDetail);

module.exports = router;
