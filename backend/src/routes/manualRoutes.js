const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middleware/authMiddleware');
const manualController = require('../controllers/manualController');

// Any authenticated role can list/download manuals — each handler filters
// to the caller's own role internally (see manualController.js), so there's
// no authorizeRoles() gate here the way adminRoutes.js has. This is a
// single shared route file instead of duplicating these two endpoints
// inside employeeRoutes.js AND raRoutes.js.

router.get('/', verifyToken, manualController.listMyManuals);
router.get('/:id/download', verifyToken, manualController.downloadManual);

module.exports = router;