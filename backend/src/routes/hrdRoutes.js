const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const hrdController = require("../controllers/hrdController");

/* ── Dashboard ─────────────────────────────────────── */
router.get(
  "/dashboard",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getHRDDashboard
);

router.get(
  "/ra-list",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getRAList
);

/* ── NEW: RA Assignment ────────────────────────────── */
router.get(
  "/ra/available-employees",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getAvailableEmployeesForRA
);

router.put(
  "/ra/:id/assign-employees",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.assignEmployeesToRA
);

/* ── NEW: Evaluation trend (last N months) ──────────── */
router.get(
  "/evaluation-trend",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getEvaluationTrend
);

/* ── NEW: Department distribution ───────────────────── */
router.get(
  "/department-stats",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getDepartmentStats
);

/* ── Employee detail & directory ────────────────────── */
router.get(
  "/employee/:id",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getEmployeeDetail
);

router.get(
  "/search",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.searchUsers
);

router.get(
  "/employees",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getAllEmployees
);

/* ── Monthly & Yearly plans ─────────────────────────── */
router.get(
  "/monthly-plans",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getMonthlyPlansList
);

router.get(
  "/yearly-plans",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getYearlyPlans
);

router.get(
  "/yearly-reports",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.getYearlyReports
);

/* ── Yearly Appraisal ───────────────────────────────── */
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

router.put(
  "/yearly-report/:id",
  verifyToken,
  authorizeRoles("HRD"),
  hrdController.evaluateYearlyReport
);

module.exports = router;