const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const raController = require("../controllers/raController");

// ─── NOTE ON "MD" IN RA ROUTES ────────────────────────────────────────────────
//  MD can switch to "RA View" in the frontend to evaluate the employees who
//  directly report to MD (those whose reportingAuthorityId = MD's userId).
//  All RA controllers already scope data by req.user.userId, so an MD calling
//  these routes sees only the employees reporting to MD — zero data leakage.
// ──────────────────────────────────────────────────────────────────────────────

router.post(
  "/monthly-evaluation",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can submit monthly evaluation
  raController.submitMonthlyEvaluation
);

router.post(
  "/quarterly-evaluation",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can generate quarterly evaluation
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
  authorizeRoles("RA", "MD"),   // MD in RA-view fetches their own RA dashboard
  raController.getRADashboard
);

router.get(
  "/monthly-trend",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can see monthly trend for their reportees
  raController.getMonthlyTrend
);
router.get(
  "/my-employees",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view sees employees who directly report to MD
  raController.getMyEmployees
);

router.get(
  "/employee/:id",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can view individual employee detail
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
  authorizeRoles("RA", "MD"),   // MD in RA-view can add quarterly remarks
  raController.updateQuarterlyRemarks
);

/* RA / MD (in RA-view): Reject a monthly plan */
router.put(
  "/monthly-plan/:id/reject",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can reject a monthly plan
  raController.rejectMonthlyPlan
);

/* Yearly Appraisal Report Evaluation — first as RA, then MD evaluates again as MD */
router.put(
  "/yearly-report/:id",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view evaluates yearly appraisal report (RA stage)
  raController.evaluateYearlyReport
);

/* Yearly Plans */
router.get(
  "/yearly-plans",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can see yearly plans of their reportees
  raController.getYearlyPlans
);

/* Yearly Reports */
router.get(
  "/yearly-reports",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can see yearly appraisal reports
  raController.getYearlyReports
);




router.get("/quarterly-evaluations/:id/full-detail",
  verifyToken,
  authorizeRoles("RA", "HRD", "MD"),
  raController.getQuarterlyFullDetail);

/* ── Extend Deadline ── */
router.patch(
  "/extend-deadline",
  verifyToken,
  authorizeRoles("RA", "MD"),   // MD in RA-view can extend deadlines
  raController.extendDeadline
);

module.exports = router;
