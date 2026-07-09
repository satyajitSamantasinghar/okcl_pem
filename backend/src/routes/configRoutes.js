const express = require('express');
const router  = express.Router();

const { verifyToken }     = require('../middleware/authMiddleware');
const { getDeadlines }    = require('../controllers/configController');

/**
 * GET /api/config/deadlines
 *
 * Returns the current monthly plan + achievement deadline configuration
 * sourced from environment variables.
 *
 * Requires: valid JWT (any authenticated role).
 * Response: { planDay: number, achievementDay: number | "last" }
 */
router.get('/deadlines', verifyToken, getDeadlines);

module.exports = router;
