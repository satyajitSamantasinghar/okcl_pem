const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const {
  allowMonthlyPlanSubmission,
  allowMonthlyAchievementSubmission,
  allowYearlyPlanSubmission,
  allowYearlyAppraisalSubmission,
  allowYearlyPlanEdit
} = require("../middleware/dateMiddleware");

const employeeController = require("../controllers/employeeController");

router.post(
  "/monthly-plan",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA is also an employee — can submit own plan
  allowMonthlyPlanSubmission,
  employeeController.submitMonthlyPlan
);

router.post(
  "/monthly-achievement",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA is also an employee — can submit own achievement
  allowMonthlyAchievementSubmission,
  employeeController.submitMonthlyAchievement
);

// Submit or save-as-draft yearly plan
// DRAFTs bypass date-window — the controller itself determines behaviour by status field
router.post(
  "/yearly-plan",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA can submit own yearly plan
  (req, res, next) => {
    // Bypass date middleware for DRAFT saves
    if (req.body.status === "DRAFT") return next();
    return allowYearlyPlanSubmission(req, res, next);
  },
  employeeController.submitYearlyPlan
);

// Edit a DRAFT plan (or upgrade DRAFT → PENDING)
// DRAFTs bypass date-window; PENDING submission goes through middleware
router.put(
  "/yearly-plan/:id",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA can edit own yearly plan draft
  (req, res, next) => {
    if (req.body.status === "DRAFT" || !req.body.status) return next();
    return allowYearlyPlanEdit(req, res, next);
  },
  employeeController.editYearlyPlan
);

// Resubmit a REJECTED plan — always bypasses date-window (forced by MD rejection)
router.post(
  "/yearly-plan/:id/resubmit",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA can resubmit own rejected yearly plan
  employeeController.resubmitYearlyPlan
);

// Get approved yearly plans for a given financial year (used by appraisal modal)
router.get(
  "/yearly-plans/approved",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA needs approved yearly plan list for appraisal modal
  employeeController.getApprovedYearlyPlans
);

router.get(
  "/monthly-plans",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  employeeController.getMonthlyPlans
);

router.get(
  "/monthly-achievements",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  employeeController.getMonthlyAchievements
);

router.get(
  "/yearly-plans",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  employeeController.getYearlyPlans
);

// Submit a new appraisal report (or create a DRAFT)
// DRAFTs bypass the date window; final SUBMITTED reports go through it
router.post(
  "/yearly-appraisal-report",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA can submit own yearly appraisal report
  (req, res, next) => {
    if (req.body.status === "DRAFT") return next();
    return allowYearlyAppraisalSubmission(req, res, next);
  },
  employeeController.submitYearlyAppraisalReport
);

// Update an existing DRAFT appraisal report (save draft or upgrade DRAFT → SUBMITTED)
// DRAFTs bypass the date window; transitioning to SUBMITTED goes through the date check.
// NOTE: For PUT requests the frontend does NOT resend financialYear (it's already in the DB),
//       so we fetch it from the record and inject it into req.body before the date middleware runs.
router.put(
  "/yearly-appraisal-report/:id",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"), // RA can update own appraisal report draft
  async (req, res, next) => {
    // DRAFTs always bypass the date-window check
    if (req.body.status === "DRAFT" || !req.body.status) return next();

    // For SUBMITTED upgrades: pull financialYear from the DB record if it wasn't sent
    if (!req.body.financialYear) {
      try {
        const { YearlyAppraisalReport } = require("../models");
        const record = await YearlyAppraisalReport.findOne({
          where: { id: req.params.id, employeeId: req.user.userId },
          attributes: ["financialYear"],
        });
        if (!record) {
          return res.status(404).json({ message: "Appraisal report not found." });
        }
        req.body.financialYear = record.financialYear;
      } catch (err) {
        return res.status(500).json({ message: "Failed to resolve financialYear for date check." });
      }
    }

    return allowYearlyAppraisalSubmission(req, res, next);
  },
  employeeController.updateYearlyAppraisalReport
);

router.get(
  "/yearly-appraisal-reports",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  employeeController.getYearlyAppraisalReports
);

/* ─── Self-scoped deadline context ───────────────────────────────────────────
   Returns the effective (possibly extended) deadline for the current user's
   own plan or achievement. No employeeId param needed — always req.user.userId.
   Used by MonthlyPlanPage to gate the Submit button and form submission.
─────────────────────────────────────────────────────────────────────────── */
router.get(
  "/my-deadline-context",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA"),
  employeeController.getMyDeadlineContext
);

module.exports = router;