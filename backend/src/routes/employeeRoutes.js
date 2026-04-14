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
  authorizeRoles("EMPLOYEE"),
  allowMonthlyPlanSubmission,
  employeeController.submitMonthlyPlan
);

router.post(
  "/monthly-achievement",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  allowMonthlyAchievementSubmission,
  employeeController.submitMonthlyAchievement
);

router.post(
  "/yearly-plan",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  allowYearlyPlanSubmission,
  employeeController.submitYearlyPlan
);

router.put(
  "/yearly-plan/:id",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  allowYearlyPlanEdit,
  employeeController.editYearlyPlan
);

router.post(
  "/yearly-plan/:id/resubmit",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  allowYearlyPlanEdit,
  employeeController.resubmitYearlyPlan
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

router.post(
  "/yearly-appraisal-report",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  allowYearlyAppraisalSubmission,
  employeeController.submitYearlyAppraisalReport
);

router.get(
  "/yearly-appraisal-reports",
  verifyToken,
  authorizeRoles("EMPLOYEE", "RA", "HRD", "MD"),
  employeeController.getYearlyAppraisalReports
);

module.exports = router;
