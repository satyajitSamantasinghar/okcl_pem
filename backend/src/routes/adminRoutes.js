const express = require('express');
const router  = express.Router();

const { verifyToken }     = require('../middleware/authMiddleware');
const { authorizeRoles }  = require('../middleware/roleMiddleware');
const adminController      = require('../controllers/adminController');

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

module.exports = router;
