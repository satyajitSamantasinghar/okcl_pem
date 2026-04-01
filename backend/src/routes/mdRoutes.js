const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const mdController = require("../controllers/mdController");

/* Dashboard */
router.get(
  "/dashboard",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getMDDashboard
);

/* Audit Logs */
router.get(
  "/audit-logs",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getAuditLogs
);

/* All employees (search) */
router.get(
  "/employees",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getAllEmployees
);

/* Employee detail */
router.get(
  "/employee/:id",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getEmployeeDetail
);

/* Reject monthly plan */
router.put(
  "/monthly-plan/:id/reject",
  verifyToken,
  authorizeRoles("MD"),
  mdController.rejectMonthlyPlan
);

/* Yearly Plan Approval */
router.put(
  "/yearly-plan/:id",
  verifyToken,
  authorizeRoles("MD"),
  mdController.approveRejectYearlyPlan
);

/* Yearly Appraisal Report Evaluation */
router.put(
  "/yearly-report/:id",
  verifyToken,
  authorizeRoles("MD"),
  mdController.evaluateYearlyReport
);

/* Legacy: final approval */
router.post(
  "/final-approval",
  verifyToken,
  authorizeRoles("MD"),
  mdController.finalApproval
);

/* Monthly Plans list (for dashboard) */
router.get(
  "/monthly-plans",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getMonthlyPlansList
);

/* Quarterly Evaluations list (for dashboard) */
router.get(
  "/quarterly-evaluations",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getQuarterlyEvalsList
);

/* Yearly Plans */
router.get(
  "/yearly-plans",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getYearlyPlans
);

/* Yearly Reports */
router.get(
  "/yearly-reports",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getYearlyReports
);

module.exports = router;
