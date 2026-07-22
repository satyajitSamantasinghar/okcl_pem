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

/* NOTE: Monthly plan rejection was moved to RA (PUT /ra/monthly-plan/:id/reject).
   MD no longer rejects monthly plans — MD's role is read-only for monthly plans. */

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

/* ── MD evaluates an RA's monthly plan (evaluatorId flow) ── */
router.post(
  "/monthly-evaluation",
  verifyToken,
  authorizeRoles("MD"),
  mdController.submitMonthlyEvaluationForRA
);

/* ── MD: list monthly evaluations for RAs under MD ── */
router.get(
  "/ra-monthly-evaluations",
  verifyToken,
  authorizeRoles("MD"),
  mdController.getRAMonthlyEvaluations
);

/* ── MD: check if MD has direct employee/RA reportees (RA-view eligibility) ── */
router.get(
  "/ra-eligibility",
  verifyToken,
  authorizeRoles("MD"),
  mdController.checkRAEligibility
);

module.exports = router;

