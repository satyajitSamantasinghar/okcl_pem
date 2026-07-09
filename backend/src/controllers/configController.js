/**
 * configController.js
 *
 * Exposes the monthly submission deadline configuration that is stored in
 * environment variables.  This is the SINGLE source of truth consumed by
 * both the date-enforcement middleware (backend) and the React deadline
 * context (frontend).
 *
 * ENV VARS (set in backend/.env):
 *   MONTHLY_PLAN_DEADLINE_DAY          integer 1-28   default: 10
 *   MONTHLY_ACHIEVEMENT_DEADLINE_DAY   integer 1-28 | "last"   default: "last"
 *
 * "last" for achievement means the last calendar day of the month, which is
 * computed dynamically per-month on the frontend.
 */

/* ── Internal helper – also exported so dateMiddleware can reuse it ── */
function parseDeadlineConfig() {
  const rawPlan = process.env.MONTHLY_PLAN_DEADLINE_DAY;
  const rawAch  = process.env.MONTHLY_ACHIEVEMENT_DEADLINE_DAY;

  // Plan day — must be an integer between 1 and 31
  const planDay = rawPlan ? parseInt(rawPlan, 10) : 10;
  if (isNaN(planDay) || planDay < 1 || planDay > 31) {
    console.warn(
      `[DeadlineConfig] Invalid MONTHLY_PLAN_DEADLINE_DAY="${rawPlan}". Falling back to 10.`
    );
  }
  const safePlanDay = isNaN(planDay) || planDay < 1 || planDay > 31 ? 10 : planDay;

  // Achievement day — integer OR the sentinel string "last"
  let safeAchDay;
  if (!rawAch || rawAch.trim().toLowerCase() === 'last') {
    safeAchDay = 'last';
  } else {
    const achDay = parseInt(rawAch, 10);
    if (isNaN(achDay) || achDay < 1 || achDay > 31) {
      console.warn(
        `[DeadlineConfig] Invalid MONTHLY_ACHIEVEMENT_DEADLINE_DAY="${rawAch}". Falling back to "last".`
      );
      safeAchDay = 'last';
    } else {
      safeAchDay = achDay;
    }
  }

  return { planDay: safePlanDay, achievementDay: safeAchDay };
}

/**
 * GET /api/config/deadlines
 * Public-ish endpoint (requires valid JWT but no specific role).
 * Returns the current deadline configuration.
 *
 * Response: { planDay: 10, achievementDay: "last" }
 *   achievementDay: number | "last"
 */
exports.getDeadlines = (req, res) => {
  try {
    const config = parseDeadlineConfig();
    return res.json(config);
  } catch (err) {
    console.error('[configController] getDeadlines error:', err);
    return res.status(500).json({ message: 'Could not load deadline configuration.' });
  }
};

// Export the parser so dateMiddleware can call it without going through HTTP
exports.parseDeadlineConfig = parseDeadlineConfig;
