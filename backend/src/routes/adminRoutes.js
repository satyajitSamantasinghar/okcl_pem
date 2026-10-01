const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { handleManualUpload } = require('../middleware/uploadMiddleware');
const adminController = require('../controllers/adminController');
const manualController = require('../controllers/manualController');

// All admin routes require a valid JWT + ADMIN role.
// Follows the exact middleware-ordering pattern of employeeRoutes.js / raRoutes.js:
//   verifyToken first (401 if token invalid/missing)
//   authorizeRoles second (403 if role doesn't match)
//   handler last

router.get(
  '/dashboard-summary',
  verifyToken,
  authorizeRoles('ADMIN'),
  adminController.getDashboardSummary,
);

router.get(
  '/employees',
  verifyToken,
  authorizeRoles('ADMIN'),
  adminController.getEmployeeList,
);

router.get(
  '/export-pdf',
  verifyToken,
  authorizeRoles('ADMIN'),
  adminController.exportComplianceReportPdf,
);

router.patch('/employees/:id/status', verifyToken, authorizeRoles('ADMIN'), adminController.updateEmployeeStatus);

// ── Employee Activity Log Report ─────────────────────────────────────────
// Reads AuditLog (already written by employeeController.js on every draft
// save / update / submit / resubmit / "Add More" append) — writes nothing.
router.get(
  '/activity-report',
  verifyToken,
  authorizeRoles('ADMIN'),
  adminController.getActivityLogReport,
);

router.get(
  '/activity-report/export-pdf',
  verifyToken,
  authorizeRoles('ADMIN'),
  adminController.exportActivityLogReportPdf,
);

// ── Manuals (in-app help center) ─────────────────────────────────────────
// handleManualUpload runs AFTER authorizeRoles so an unauthorized request
// never reaches multer's disk write.
router.post(
  '/manuals',
  verifyToken,
  authorizeRoles('ADMIN'),
  handleManualUpload,
  manualController.uploadManual,
);

router.get(
  '/manuals',
  verifyToken,
  authorizeRoles('ADMIN'),
  manualController.listAllManuals,
);

router.patch(
  '/manuals/:id',
  verifyToken,
  authorizeRoles('ADMIN'),
  handleManualUpload,
  manualController.updateManual,
);

router.patch(
  '/manuals/:id/status',
  verifyToken,
  authorizeRoles('ADMIN'),
  manualController.updateManualStatus,
);

module.exports = router;